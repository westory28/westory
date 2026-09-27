import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Exercise the real controller's event handlers and hook state without adding a
// DOM dependency. This does not replace browser layout/accessibility checks.
const sourcePath = "src/components/common/TeacherPatchMemoController.tsx";
const compiled = ts.transpileModule(readFileSync(resolve(sourcePath), "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React,
    esModuleInterop: true,
  },
}).outputText;
const deferred = () => {
  let resolvePromise;
  let reject;
  const promise = new Promise((yes, no) => {
    resolvePromise = yes;
    reject = no;
  });
  return { promise, resolve: resolvePromise, reject };
};
const note = (id) => ({
  id,
  ownerUid: "teacher",
  noteRevision: 3,
  title: `Memo ${id}`,
  body: `Body ${id}`,
  type: "bug",
  priority: "normal",
  status: "open",
  sourcePath: "/teacher/dashboard",
});
const walk = (node) => {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== "object") return [];
  return [node, ...walk(node.props?.children)];
};
const text = (node) => {
  if (Array.isArray(node)) return node.map(text).join("");
  if (!node || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  return text(node.props?.children);
};

const harness = async (operations = {}, options = {}) => {
  const slots = [];
  const effects = [];
  const calls = [];
  const toasts = [];
  let cursor = 0;
  let dirty = true;
  let tree;
  let listener;
  let errorListener;
  let subscriptions = 0;
  let preparations = 0;
  const authState = {
    currentUser: { uid: "teacher" },
    userData: { role: "admin" },
  };
  const sameDeps = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]));
  const react = {
    Fragment: "fragment",
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children },
    }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots))
        slots[index] = {
          value: typeof initial === "function" ? initial() : initial,
        };
      return [
        slots[index].value,
        (next) => {
          const value =
            typeof next === "function" ? next(slots[index].value) : next;
          if (!Object.is(value, slots[index].value)) {
            slots[index].value = value;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!sameDeps(slots[index]?.deps, deps))
        slots[index] = { value: factory(), deps };
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!sameDeps(slots[index]?.deps, deps)) {
        effects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const location = { pathname: "/teacher/dashboard", search: "" };
  const showToast = (value) => toasts.push(value);
  const api = {};
  for (const name of [
    "createTeacherPatchNote",
    "updateTeacherPatchNote",
    "updateTeacherPatchNoteStatus",
    "deleteTeacherPatchNote",
  ]) {
    api[name] = async (...args) => {
      calls.push({ name, args });
      return (
        operations[name]?.(...args) ?? {
          noteId: "created",
          noteRevision: 4,
          status: "open",
          deleted: false,
        }
      );
    };
  }
  const modules = {
    react,
    "react-router-dom": { useLocation: () => location },
    "../../contexts/AuthContext": {
      useAuth: () => authState,
    },
    "../../lib/permissions": {
      isAdminUser: () => authState.userData?.role === "admin",
    },
    "../../lib/teacherPatchNoteCommands": {
      prepareTeacherPatchNoteSession: async (uid) => {
        preparations += 1;
        await operations.prepareTeacherPatchNoteSession?.(uid);
      },
      getTeacherPatchNoteErrorMessage: () => "저장 오류",
    },
    "../../lib/teacherPatchNotes": {
      ...api,
      subscribeTeacherPatchNotes: (_uid, next, onError) => {
        subscriptions += 1;
        listener = next;
        errorListener = onError;
        next([note("A"), note("B")]);
        return () => {
          listener = undefined;
        };
      },
    },
    "./AppToastProvider": { useAppToast: () => ({ showToast }) },
  };
  const exports = {};
  const browser = {
    setTimeout: () => 1,
    clearTimeout() {},
    addEventListener() {},
    removeEventListener() {},
    confirm: () => true,
  };
  vm.runInNewContext(
    compiled,
    {
      exports,
      require: (name) => {
        assert.ok(name in modules, `Unexpected dependency ${name}`);
        return modules[name];
      },
      console: { ...console, error() {} },
      window: browser,
      document: { ...browser, body: { style: {} } },
    },
    { filename: sourcePath },
  );
  const render = () => {
    let iterations = 0;
    while (dirty) {
      assert.ok(++iterations < 30, "Hook state should stabilize");
      dirty = false;
      cursor = 0;
      tree = exports.default();
      effects.splice(0).forEach((effect) => effect());
    }
    return tree;
  };
  const find = (predicate, root = render()) => {
    const found = walk(root).find(predicate);
    assert.ok(found, "Expected rendered control is missing");
    return found;
  };
  const button = (label, root) =>
    find(
      (item) =>
        item.type === "button" &&
        (item.props["aria-label"] === label || text(item).trim() === label),
      root,
    );
  const article = (id) =>
    find((item) => item.type === "article" && item.props.key === id);
  const edit = (id) => {
    find(
      (item) => item.type === "button" && text(item).includes(`Body ${id}`),
      article(id),
    ).props.onClick();
    render();
  };
  const settle = async () => {
    for (let i = 0; i < 12; i++) {
      await Promise.resolve();
      render();
    }
  };
  render();
  await settle();
  if (options.open !== false) {
    button("패치 메모 열기").props.onClick();
    render();
    await settle();
  }
  return {
    calls,
    toasts,
    button,
    article,
    edit,
    render,
    settle,
    textarea: () => find((item) => item.type === "textarea"),
    type: (body) => {
      find((item) => item.type === "textarea").props.onChange({
        target: { value: body },
      });
      render();
    },
    emit: (notes) => {
      assert.ok(listener);
      listener(notes);
      render();
    },
    failSubscription: () => {
      assert.ok(errorListener);
      errorListener(new Error("offline"));
      render();
    },
    subscriptionCount: () => subscriptions,
    preparationCount: () => preparations,
    changeUser: (uid, role = "admin") => {
      authState.currentUser = uid ? { uid } : null;
      authState.userData = uid ? { role } : null;
      dirty = true;
      render();
    },
    changeRoute: (pathname) => {
      location.pathname = pathname;
      dirty = true;
      render();
    },
    unmount: () => slots.forEach((slot) => slot?.cleanup?.()),
  };
};

const checks = [];
const check = async (name, run) => {
  await run();
  checks.push(name);
};

for (const operation of [
  "updateTeacherPatchNoteStatus",
  "deleteTeacherPatchNote",
]) {
  await check(
    `${operation}: late A response preserves B draft and revision`,
    async () => {
      const pending = deferred();
      const h = await harness({ [operation]: () => pending.promise });
      h.edit("A");
      const label =
        operation === "deleteTeacherPatchNote"
          ? "패치 메모 삭제"
          : "패치 메모 완료 처리";
      const action = h.button(label, h.article("A"));
      action.props.onClick();
      // Duplicate events before React rerenders must be fenced by the ref lock.
      action.props.onClick();
      assert.equal(h.calls.filter((call) => call.name === operation).length, 1);
      h.render();
      assert.equal(h.button(label, h.article("A")).props.disabled, true);
      h.edit("B");
      h.type("B unsaved draft");
      pending.resolve({
        noteId: "A",
        noteRevision: 4,
        status: "done",
        deleted: operation === "deleteTeacherPatchNote",
      });
      await h.settle();
      assert.equal(h.textarea().props.value, "B unsaved draft");
      await h.button("수정 저장").props.onClick();
      const saved = h.calls.find(
        (call) => call.name === "updateTeacherPatchNote",
      );
      assert.equal(saved.args[1], "B");
      assert.equal(saved.args[2], 3, "A response must not advance B revision");
      assert.equal(saved.args[3].body, "B unsaved draft");
    },
  );
}

await check(
  "Failed save keeps the draft after closing and reopening the panel",
  async () => {
    const h = await harness({
      createTeacherPatchNote: async () => {
        throw new Error("offline");
      },
    });
    h.type("Draft retained after save failure");
    await h.button("추가").props.onClick();
    h.render();
    assert.equal(h.toasts.at(-1).tone, "error");
    h.button("패치 메모 닫기").props.onClick();
    h.render();
    h.button("패치 메모 열기").props.onClick();
    h.render();
    assert.equal(h.textarea().props.value, "Draft retained after save failure");
  },
);

await check(
  "Repeated submit events make one request and preserve inputs while pending",
  async () => {
    const pending = deferred();
    const h = await harness({ createTeacherPatchNote: () => pending.promise });
    h.type("Save once");
    const submit = h.button("추가");
    const first = submit.props.onClick();
    const second = submit.props.onClick();
    assert.equal(
      h.calls.filter((call) => call.name === "createTeacherPatchNote").length,
      1,
    );
    h.render();
    assert.equal(h.textarea().props.disabled, true);
    assert.equal(h.button("저장 중").props.disabled, true);
    pending.resolve({
      noteId: "created",
      noteRevision: 1,
      status: "open",
      deleted: false,
    });
    await Promise.all([first, second]);
    h.render();
    assert.equal(h.textarea().props.value, "");
  },
);

await check(
  "Reopening after a terminal subscription error resubscribes without losing the draft",
  async () => {
    const h = await harness();
    h.type("Keep draft during subscription recovery");
    assert.equal(h.subscriptionCount(), 1);
    h.failSubscription();
    h.button("패치 메모 닫기").props.onClick();
    h.render();
    h.button("패치 메모 열기").props.onClick();
    h.render();
    await h.settle();
    assert.equal(h.subscriptionCount(), 2);
    assert.equal(
      h.textarea().props.value,
      "Keep draft during subscription recovery",
    );
  },
);

await check(
  "Login waits for the application session before reading closed-panel memos",
  async () => {
    const pending = deferred();
    const h = await harness(
      { prepareTeacherPatchNoteSession: () => pending.promise },
      { open: false },
    );
    assert.equal(h.preparationCount(), 1);
    assert.equal(h.subscriptionCount(), 0);
    assert.equal(h.toasts.length, 0);
    pending.resolve();
    await h.settle();
    assert.equal(h.subscriptionCount(), 1);
    assert.equal(h.toasts.length, 0);
    h.button("패치 메모 열기").props.onClick();
    await h.settle();
    h.article("A");
    assert.equal(h.preparationCount(), 1);
  },
);

for (const transition of ["logout", "student", "route", "unmount"]) {
  for (const fails of [false, true]) {
    await check(
      `Pending session ${fails ? "failure" : "success"} is ignored after ${transition}`,
      async () => {
        const pending = deferred();
        const h = await harness(
          { prepareTeacherPatchNoteSession: () => pending.promise },
          { open: false },
        );
        if (transition === "logout") h.changeUser(null);
        if (transition === "student") h.changeUser("student", "student");
        if (transition === "route") h.changeRoute("/student/dashboard");
        if (transition === "unmount") h.unmount();
        if (fails) pending.reject(new Error("session failed"));
        else pending.resolve();
        await h.settle();
        assert.equal(h.subscriptionCount(), 0);
        assert.equal(h.toasts.length, 0);
      },
    );
  }
}

await check(
  "Failed login preparation is retried on panel open without losing a draft",
  async () => {
    let attempts = 0;
    const h = await harness(
      {
        prepareTeacherPatchNoteSession: async () => {
          if (++attempts === 1) throw new Error("offline");
        },
      },
      { open: false },
    );
    assert.equal(h.subscriptionCount(), 0);
    assert.equal(h.toasts.length, 1);
    h.button("패치 메모 열기").props.onClick();
    h.type("Retain draft during login recovery");
    await h.settle();
    assert.equal(h.subscriptionCount(), 1);
    assert.equal(
      h.textarea().props.value,
      "Retain draft during login recovery",
    );
  },
);

console.log(
  JSON.stringify({
    suite: "teacher-patch-memo-controller",
    passed: true,
    checks,
  }),
);
