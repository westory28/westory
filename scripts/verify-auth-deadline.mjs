import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(
  fs.readFileSync(
    new URL("../src/lib/authDeadline.ts", import.meta.url),
    "utf8",
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
const harness = (hidden = false) => {
  let now = 0,
    next = 0;
  const timers = new Map();
  const target = () => {
    const listeners = new Map();
    return {
      addEventListener: (name, fn) => {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(fn);
      },
      removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
      emit: (name) => [...(listeners.get(name) || [])].forEach((fn) => fn()),
      count: () =>
        [...listeners.values()].reduce((sum, value) => sum + value.size, 0),
    };
  };
  const document = { ...target(), hidden };
  const window = {
    ...target(),
    setTimeout: (fn, delay) => {
      const id = ++next;
      timers.set(id, { fn, due: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    window,
    document,
    performance: { now: () => now },
  });
  return {
    ...exports,
    document,
    window,
    advance: (ms) => {
      const until = now + ms;
      while (true) {
        const first = [...timers]
          .filter(([, item]) => item.due <= until)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!first) break;
        now = first[1].due;
        timers.delete(first[0]);
        first[1].fn();
      }
      now = until;
    },
    hide: () => {
      document.hidden = true;
      document.emit("visibilitychange");
    },
    show: () => {
      document.hidden = false;
      document.emit("visibilitychange");
    },
    clean: () => {
      assert.equal(
        timers.size,
        0,
        "No native timer may survive completion/cancellation",
      );
      assert.equal(
        document.count() + window.count(),
        0,
        "Lifecycle listeners must be removed",
      );
    },
  };
};
let cases = 0;
const check = (name, run) => {
  try {
    run();
    cases++;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
};
check("Visible network work still has a finite deadline", () => {
  const h = harness();
  let fired = 0;
  h.setAuthDeadline(() => fired++, 60000);
  h.advance(59999);
  assert.equal(fired, 0);
  h.advance(1);
  assert.equal(fired, 1);
  h.advance(60000);
  assert.equal(fired, 1);
  h.clean();
});
check("Google chooser background time does not fail a mobile sign-in", () => {
  const h = harness();
  let fired = false;
  const id = h.setAuthDeadline(() => {
    fired = true;
  }, 60000);
  h.advance(10000);
  h.hide();
  h.advance(300000);
  h.show();
  h.advance(30000);
  assert.equal(fired, false);
  h.clearAuthDeadline(id);
  h.advance(60000);
  assert.equal(fired, false);
  h.clean();
});
check("Visibility changes preserve remaining time rather than reset it", () => {
  const h = harness();
  let fired = false;
  h.setAuthDeadline(() => {
    fired = true;
  }, 60000);
  h.advance(10000);
  h.hide();
  h.advance(300000);
  h.show();
  h.advance(20000);
  h.hide();
  h.advance(300000);
  h.show();
  h.window.emit("pageshow");
  h.show();
  h.advance(29999);
  assert.equal(fired, false);
  h.advance(1);
  assert.equal(fired, true);
  h.clean();
});
check("Initially background restoration waits until foreground", () => {
  const h = harness(true);
  let fired = false;
  h.setAuthDeadline(() => {
    fired = true;
  }, 60000);
  h.advance(300000);
  assert.equal(fired, false);
  h.show();
  h.advance(60000);
  assert.equal(fired, true);
  h.clean();
});
check(
  "A delayed hidden timer cannot consume an unknown suspension interval",
  () => {
    const h = harness();
    let fired = false;
    h.setAuthDeadline(() => {
      fired = true;
    }, 60000);
    h.advance(10000);
    h.document.hidden = true;
    h.advance(300000);
    assert.equal(fired, false);
    h.show();
    h.advance(30000);
    assert.equal(fired, false);
    h.advance(30000);
    assert.equal(fired, true);
    h.clean();
  },
);
check("Web app page cache suspension preserves remaining time", () => {
  const h = harness();
  let fired = false;
  h.setAuthDeadline(() => {
    fired = true;
  }, 60000);
  h.advance(5000);
  h.window.emit("pagehide");
  h.advance(300000);
  h.show();
  h.advance(60000);
  assert.equal(fired, false);
  h.window.emit("pageshow");
  h.advance(54999);
  assert.equal(fired, false);
  h.advance(1);
  assert.equal(fired, true);
  h.clean();
});
check("Canceled background generations cannot fail their replacement", () => {
  const h = harness();
  let oldFired = false,
    newFired = false;
  const old = h.setAuthDeadline(() => {
    oldFired = true;
  }, 60000);
  h.hide();
  h.clearAuthDeadline(old);
  h.clearAuthDeadline(old);
  const next = h.setAuthDeadline(() => {
    newFired = true;
  }, 60000);
  h.advance(300000);
  h.show();
  h.advance(30000);
  assert.equal(oldFired, false);
  assert.equal(newFired, false);
  h.clearAuthDeadline(next);
  h.clean();
});
check("Concurrent deadlines and cleanup remain independent", () => {
  const h = harness();
  let completed = [];
  h.setAuthDeadline(() => completed.push(1), 1000);
  h.setAuthDeadline(() => completed.push(2), 2000);
  h.advance(500);
  h.hide();
  h.advance(300000);
  h.show();
  h.advance(500);
  assert.deepEqual(completed, [1]);
  h.advance(1000);
  assert.deepEqual(completed, [1, 2]);
  h.clean();
});
console.log(`Auth foreground deadline regression checks passed: ${cases}`);
