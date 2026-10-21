import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the real component's hooks with deferred notification service calls.
// No Firebase, browser account, notification, or production record is changed.
const source = ts.transpileModule(
  readFileSync("src/components/common/NotificationBell.tsx", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  },
).outputText;
const stamp = (value) => ({ toMillis: () => value });
const notification = (id, extra = {}) => ({
  id,
  type: "history_classroom_passed",
  title: `역사교실 ${id}`,
  body: `${id} 학생 통과`,
  targetUrl: "/teacher/quiz/history-classroom",
  createdAt: stamp(1000),
  readAt: null,
  ...extra,
});
const same = (left, right) =>
  left &&
  right &&
  left.length === right.length &&
  left.every((value, index) => Object.is(value, right[index]));
const text = (node) =>
  Array.isArray(node)
    ? node.map(text).join("")
    : node && typeof node === "object"
      ? text(node.props?.children)
      : String(node ?? "");
const find = (node, predicate) => {
  if (Array.isArray(node))
    return node.map((item) => find(item, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  return predicate(node) ? node : find(node.props?.children, predicate);
};

const fixture = async (role = "teacher") => {
  const slots = [];
  let cursor = 0;
  let dirty = false;
  let effects = [];
  let tree;
  let serial = 0;
  let inboxCallback;
  let broadcastCallback;
  let rows = [];
  let broadcasts = [];
  let inbox = { uid: `${role}-a`, unreadCount: 0, updatedAt: stamp(++serial) };
  const auth = {
    currentUser: { uid: `${role}-a` },
    config: { year: "2026", semester: "2" },
    userData: { role },
  };
  const calls = { loads: [], reads: [], toasts: [], routes: [], errors: [] };
  let deferredLoads = false;
  let deferredReads = false;
  let activeReads = 0;
  let maxActiveReads = 0;
  let failRead = false;
  const react = {
    useState(initial) {
      const index = cursor++;
      slots[index] ||= {
        value: typeof initial === "function" ? initial() : initial,
      };
      return [
        slots[index].value,
        (next) => {
          const value =
            typeof next === "function" ? next(slots[index].value) : next;
          if (!Object.is(slots[index].value, value)) {
            slots[index].value = value;
            dirty = true;
          }
        },
      ];
    },
    useRef(value) {
      return (slots[cursor++] ||= { current: value });
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps))
        slots[index] = { deps, value: factory() };
      return slots[index].value;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) {
        const previous = slots[index];
        slots[index] = { deps, cleanup: previous?.cleanup };
        effects.push(() => {
          slots[index].cleanup?.();
          slots[index].cleanup = callback();
        });
      }
    },
  };
  react.useLayoutEffect = react.useEffect;
  const currentItems = (options) => [
    ...rows,
    ...(options?.includeBroadcasts ? broadcasts : []),
  ];
  const emitInbox = (extra = {}) => {
    inbox = { ...inbox, ...extra };
    inboxCallback?.(inbox);
  };
  const service = {
    subscribeNotificationInbox(config, uid, callback) {
      inboxCallback = callback;
      callback(inbox);
      return () => {
        if (inboxCallback === callback) inboxCallback = null;
      };
    },
    subscribeBroadcastNotifications(config, callback) {
      broadcastCallback = callback;
      callback(broadcasts);
      return () => {
        if (broadcastCallback === callback) broadcastCallback = null;
      };
    },
    loadNotifications(config, uid, options) {
      const captured = currentItems(options).map((item) => ({ ...item }));
      return new Promise((resolve) => {
        const call = { config, uid, captured, resolve, done: false };
        calls.loads.push(call);
        if (!deferredLoads) {
          call.done = true;
          resolve(captured);
        }
      });
    },
    markNotificationsRead(config, input) {
      const itemIds = Array.from(input.itemIds);
      const captured = currentItems({ includeBroadcasts: role === "student" })
        .filter(
          (item) =>
            !item.readAt &&
            (item.broadcast
              ? item.createdAt.toMillis() <=
                Number(input.broadcastReadThroughMs || 0)
              : itemIds.includes(item.id)),
        )
        .map((item) => item.id);
      activeReads++;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      return new Promise((resolve, reject) => {
        const call = {
          config,
          input: { ...input, itemIds },
          captured,
          done: false,
        };
        call.finish = (failed = false) => {
          assert(!call.done, "Read completion must run once");
          call.done = true;
          activeReads--;
          if (failed) return reject(new Error("synthetic-read-failure"));
          const readAt = stamp(++serial);
          const mark = (item) =>
            captured.includes(item.id) ? { ...item, readAt } : item;
          rows = rows.map(mark);
          broadcasts = broadcasts.map(mark);
          emitInbox({
            unreadCount: rows.filter((item) => !item.readAt).length,
            updatedAt: readAt,
            ...(input.broadcastReadThroughMs
              ? { lastBroadcastReadAt: stamp(input.broadcastReadThroughMs) }
              : {}),
          });
          resolve();
        };
        calls.reads.push(call);
        if (!deferredReads) call.finish(failRead);
      });
    },
    clearNotifications: async () => {},
  };
  const showToast = (value) => calls.toasts.push(value);
  const confirm = async () => true;
  const navigate = (value) => calls.routes.push(value);
  const jsx = (type, props) => ({ type, props });
  const component = { exports: {} };
  vm.runInNewContext(source, {
    exports: component.exports,
    module: component,
    console: { error: (...args) => calls.errors.push(args), warn() {} },
    document: { addEventListener() {}, removeEventListener() {} },
    window: {
      requestAnimationFrame: () => 1,
      cancelAnimationFrame() {},
    },
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime")
        return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "react-router-dom") return { useNavigate: () => navigate };
      if (name.endsWith("/AuthContext")) return { useAuth: () => auth };
      if (name.endsWith("/notifications")) return service;
      if (name.endsWith("/AppToastProvider"))
        return { useAppToast: () => ({ showToast }) };
      if (name.endsWith("/AppDialogProvider"))
        return { useAppDialog: () => ({ confirm }) };
      if (name.endsWith("/LoadingState")) return { InlineLoading: "loading" };
      if (name === "firebase/firestore" || name.endsWith("/firebase"))
        return {};
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const render = async () => {
    dirty = true;
    for (let iteration = 0; iteration < 60; iteration++) {
      if (dirty) {
        dirty = false;
        cursor = 0;
        tree = component.exports.default({});
        const pending = effects;
        effects = [];
        pending.forEach((effect) => effect());
      }
      await Promise.resolve();
      await Promise.resolve();
      if (!dirty && iteration > 4) return;
    }
    assert.fail("Notification hooks did not settle; possible read/load loop");
  };
  await render();
  return {
    calls,
    auth,
    render,
    text: () => text(tree),
    rows: () => rows,
    maxActiveReads: () => maxActiveReads,
    holdLoads: (value) => (deferredLoads = value),
    holdReads: (value) => (deferredReads = value),
    failReads: (value) => (failRead = value),
    setRows: (value) => (rows = value),
    emit: async (extra = {}) => {
      emitInbox({ updatedAt: stamp(++serial), ...extra });
      await render();
    },
    repeat: async () => {
      inboxCallback?.({ ...inbox });
      await render();
    },
    broadcasts: async (value) => {
      broadcasts = value;
      broadcastCallback?.(value);
      await render();
    },
    button: (label) =>
      find(
        tree,
        (node) =>
          node.type === "button" &&
          (label instanceof RegExp
            ? label.test(text(node.props.children))
            : node.props["aria-label"] === label ||
              text(node.props.children) === label),
      ),
    toggle: async () => {
      find(
        tree,
        (node) => node.type === "button" && "aria-expanded" in node.props,
      ).props.onClick();
      await render();
    },
    resolveLoads: async (callsToResolve, override) => {
      for (const call of callsToResolve) {
        assert(!call.done, "Load completion must run once");
        call.done = true;
        call.resolve(override || call.captured);
      }
      await render();
    },
  };
};

{
  const f = await fixture();
  assert.equal(f.calls.loads.length, 0, "Closed bell does not fetch items");
  await f.toggle();
  assert.match(f.text(), /받은 알림이 없습니다/);
  f.setRows([notification("new-pass")]);
  await f.emit({ unreadCount: 1 });
  assert.match(f.text(), /역사교실 new-pass/);
  assert.equal(f.calls.toasts.length, 1);
  assert.equal(f.calls.toasts[0].persistent, true);
  assert.equal(f.calls.reads.length, 1);
  assert.deepEqual(f.calls.reads[0].input.itemIds, ["new-pass"]);
  const settledLoads = f.calls.loads.length;
  await f.repeat();
  assert.equal(f.calls.loads.length, settledLoads);
  assert.equal(
    f.calls.reads.length,
    1,
    "Read receipt does not cause a read loop",
  );
  assert.equal(
    f.calls.toasts.length,
    1,
    "Repeated inbox does not repeat toast",
  );

  // The server may replace its inbox timestamp while its unread count stays 0.
  f.setRows([notification("zero-count")]);
  await f.emit({ unreadCount: 0 });
  assert.match(f.text(), /역사교실 zero-count/);
  assert.equal(f.calls.reads.length, 2);
}

{
  const f = await fixture();
  await f.toggle();
  f.holdLoads(true);
  f.holdReads(true);
  f.setRows([notification("old")]);
  await f.emit({ unreadCount: 1 });
  const oldLoads = f.calls.loads.filter((call) => !call.done);
  f.setRows([notification("newer")]);
  await f.emit({ unreadCount: 2 });
  const newLoads = f.calls.loads.filter(
    (call) => !call.done && !oldLoads.includes(call),
  );
  assert.equal(
    f.calls.reads.length,
    0,
    "Unread items are not marked before loading",
  );
  await f.resolveLoads(newLoads);
  assert.match(f.text(), /역사교실 newer/);
  await f.resolveLoads(oldLoads);
  assert.match(f.text(), /역사교실 newer/);
  assert.doesNotMatch(f.text(), /역사교실 old/);
  assert.equal(f.calls.reads.length, 1);
  assert.deepEqual(f.calls.reads[0].captured, ["newer"]);
  assert.equal(f.calls.toasts.length, 1, "Stale toast request is ignored");

  f.holdLoads(false);
  f.setRows([notification("during-read"), notification("newer")]);
  await f.emit({ unreadCount: 3 });
  await f.repeat();
  assert.match(f.text(), /역사교실 during-read/);
  assert.equal(
    f.calls.reads.length,
    1,
    "Repeated snapshots share one active read",
  );
  f.calls.reads[0].finish();
  await f.render();
  assert.equal(
    f.calls.reads.length,
    2,
    "Distinct arrival queues a follow-up read",
  );
  assert.deepEqual(f.calls.reads[1].captured, ["during-read"]);
  assert.deepEqual(f.calls.reads[1].input.itemIds, ["during-read"]);
  f.calls.reads[1].finish();
  await f.render();
  await f.repeat();
  assert.equal(f.calls.reads.length, 2);
  assert.equal(f.maxActiveReads(), 1);
}

{
  const f = await fixture();
  await f.toggle();
  f.holdLoads(true);
  f.holdReads(true);
  f.setRows([notification("displayed")]);
  await f.emit({ unreadCount: 1 });
  const displayedLoads = f.calls.loads.filter((call) => !call.done);
  // A later item exists at read time but was absent from every completed load.
  f.setRows([notification("unseen"), notification("displayed")]);
  await f.resolveLoads(displayedLoads);
  assert.equal(f.calls.reads.length, 1);
  assert.deepEqual(f.calls.reads[0].input.itemIds, ["displayed"]);
  f.calls.reads[0].finish();
  await f.render();
  assert.equal(f.rows().find((item) => item.id === "unseen").readAt, null);
  assert.equal(
    f.calls.reads.length,
    1,
    "Unseen arrival waits for its own load",
  );
}

{
  const f = await fixture();
  await f.toggle();
  f.failReads(true);
  f.setRows([notification("read-retry")]);
  await f.emit({ unreadCount: 1 });
  assert.equal(f.calls.reads.length, 1);
  assert.equal(f.calls.errors.length, 1);
  await f.repeat();
  assert.equal(f.calls.reads.length, 1, "Read failure does not spin");
  f.failReads(false);
  await f.toggle();
  await f.toggle();
  assert.equal(f.calls.reads.length, 2, "Reopening permits retry");
  assert.match(f.text(), /역사교실 read-retry/);
}

{
  const f = await fixture();
  await f.toggle();
  f.holdLoads(true);
  f.setRows([notification("old-scope")]);
  await f.emit({ unreadCount: 1 });
  const oldLoads = f.calls.loads.filter((call) => !call.done);
  f.auth.currentUser = { uid: "teacher-b" };
  f.auth.config = { year: "2026", semester: "1" };
  f.setRows([
    notification("new-scope", {
      type: "history_classroom_locked",
      targetUrl: "/teacher/quiz/history-classroom?assignmentId=assignment-new",
    }),
  ]);
  await f.render();
  const newLoads = f.calls.loads.filter(
    (call) => !call.done && !oldLoads.includes(call),
  );
  await f.resolveLoads(newLoads);
  await f.resolveLoads(oldLoads);
  assert.match(f.text(), /역사교실 new-scope/);
  assert.doesNotMatch(f.text(), /역사교실 old-scope/);
  f.button("역사교실 new-scopenew-scope 학생 통과").props.onClick();
  assert.equal(
    f.calls.routes.at(-1),
    "/teacher/quiz/history-classroom?assignmentId=assignment-new",
  );
}

{
  const f = await fixture("student");
  await f.toggle();
  await f.broadcasts([notification("broadcast", { broadcast: true })]);
  assert.match(f.text(), /역사교실 broadcast/);
  assert.equal(f.calls.toasts.length, 1);
  assert.equal(f.calls.toasts[0].persistent, false);
  assert.equal(f.calls.reads.length, 1);
  assert.deepEqual(f.calls.reads[0].input.itemIds, []);
  assert.equal(f.calls.reads[0].input.broadcastReadThroughMs, 1000);
  await f.repeat();
  assert.equal(f.calls.reads.length, 1);
}

{
  const f = await fixture();
  f.setRows([
    notification("legacy-pass", {
      body: "홍길동 학생이 ① 조선 건국, 500년 역사의 시작을(를) 93.3%로 통과했습니다.",
    }),
    notification("legacy-fail", {
      type: "history_classroom_failed",
      body: "김학생 학생이 긴 과제 제목을(를) 0%로 미통과했습니다.",
      targetUrl: "/teacher/quiz?menu=history2",
    }),
    notification("student-assignment", {
      type: "history_classroom_assigned",
      body: "공개된 원래 과제 이름 과제가 새로 열렸습니다.",
    }),
  ]);
  await f.emit({ unreadCount: 3 });
  assert.equal(
    f.calls.toasts.at(-1).message,
    "홍길동 학생이 역사교실을 93.3%로 통과했습니다.",
  );
  await f.toggle();
  assert.match(f.text(), /홍길동 학생이 역사교실을 93\.3%로 통과했습니다\./);
  assert.match(f.text(), /김학생 학생이 역사교실을 0%로 미통과했습니다\./);
  assert.doesNotMatch(f.text(), /500년 역사의 시작|긴 과제 제목/);
  assert.match(f.text(), /공개된 원래 과제 이름 과제가 새로 열렸습니다\./);
  f.button(/legacy-fail/).props.onClick();
  assert.equal(f.calls.routes.at(-1), "/teacher/quiz/history-classroom");
}

{
  const config = { year: "2026", semester: "2" };
  const calls = [];
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("src/lib/notifications.ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports: module.exports,
      module,
      require(name) {
        if (name === "./semesterScope")
          return { getYearSemester: (value) => value };
        if (name === "./studentProfileCommands")
          return {
            callStudentDataService: async (name, input) =>
              calls.push({ name, input }),
          };
        if (name === "./firebase")
          return {
            getHttpsCallable: () =>
              assert.fail("Inbox must not call retired notification callables"),
          };
        return {};
      },
    },
  );
  await module.exports.markNotificationsRead(config, {
    itemIds: ["shown", "shown"],
    broadcastReadThroughMs: 1234,
  });
  await module.exports.clearNotifications(config);
  assert.equal(calls[0].name, "manageNotificationInbox");
  assert.equal(calls[0].input.action, "MARK_READ");
  assert.deepEqual(Array.from(calls[0].input.itemIds), ["shown"]);
  assert.equal(calls[0].input.broadcastReadThroughMs, 1234);
  assert.equal(calls[0].input.year, "2026");
  assert.equal(calls[0].input.semester, "2");
  assert.equal(calls[1].name, "manageNotificationInbox");
  assert.equal(calls[1].input.action, "CLEAR");
}

{
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        "src/pages/teacher/components/SettingsNotifications.tsx",
        "utf8",
      ) + "\nexport { NOTIFICATION_EVENTS, normalizeConfig };",
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
    { exports: module.exports, module, require: () => ({}) },
  );
  const event = module.exports.NOTIFICATION_EVENTS.find(
    (item) => item.key === "history_classroom_locked",
  );
  assert.equal(event.audience, "teachers");
  assert.equal(event.status, "connected");
  const migrated = module.exports.normalizeConfig({
    teacherNotificationsEnabled: false,
    eventPolicies: {
      history_classroom_passed: { enabled: false, titleTemplate: "기존 제목" },
      history_classroom_failed: {
        bodyTemplate: "과제 {assignmentTitle}: {percent}%",
      },
    },
  });
  assert.equal(migrated.teacherNotificationsEnabled, false);
  assert.equal(migrated.eventPolicies.history_classroom_passed.enabled, false);
  assert.equal(
    migrated.eventPolicies.history_classroom_passed.titleTemplate,
    "기존 제목",
  );
  assert.equal(migrated.eventPolicies.history_classroom_locked.enabled, true);
  assert.equal(migrated.eventPolicies.history_classroom_failed.enabled, true);
  assert.equal(
    migrated.eventPolicies.history_classroom_passed.bodyTemplate,
    "{studentName} 학생이 역사교실을 {percent}%로 통과했습니다.",
  );
  assert.equal(
    migrated.eventPolicies.history_classroom_failed.bodyTemplate,
    "{studentName} 학생이 역사교실을 {percent}%로 미통과했습니다.",
  );
  assert.equal(
    migrated.eventPolicies.history_classroom_locked.priority,
    "high",
  );
}

console.log(
  "PASS: notification arrivals refresh open panel; reads wait for fetched items, serialize concurrent arrivals, avoid loops, reject stale scope responses, preserve teacher/student toasts and broadcast updates",
);
