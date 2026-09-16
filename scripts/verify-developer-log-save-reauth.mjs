// Execute the actual page, protected boundary, reauth coordinator, and image
// helpers. The hook host runs effects/cleanup and creates a fresh instance when
// the real boundary removes its children; only I/O and the DOM are synthetic.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const paths = [
  "src/pages/DeveloperLog.tsx",
  "src/components/auth/ProtectedAccessBoundary.tsx",
  "src/lib/developerLogImages.ts",
  "src/lib/developerLogs.ts",
  "src/lib/stepUpReauth.ts",
];
const code = Object.fromEntries(
  await Promise.all(
    paths.map(async (path) => [
      path,
      ts.transpileModule(
        await readFile(new URL(`../${path}`, import.meta.url), "utf8"),
        {
          fileName: path,
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.React,
          },
        },
      ).outputText,
    ]),
  ),
);
const load = (path, dependencies, globals = {}) => {
  const module = { exports: {} };
  runInNewContext(code[path], {
    module,
    exports: module.exports,
    Blob,
    Date,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    console: { error() {}, warn() {} },
    fetch: () => assert.fail("Network is forbidden"),
    require: (name) => {
      assert.ok(
        Object.hasOwn(dependencies, name),
        `Unexpected dependency ${name}`,
      );
      return dependencies[name];
    },
    ...globals,
  });
  return module.exports;
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const allNodes = (tree) => {
  if (tree === null || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(allNodes);
  return [tree, ...allNodes(tree.props?.children)];
};
const text = (tree) => {
  if (tree === null || tree === undefined || typeof tree === "boolean")
    return "";
  if (typeof tree !== "object") return String(tree);
  return Array.isArray(tree)
    ? tree.map(text).join("")
    : text(tree.props?.children);
};

const fixture = () => {
  const owner = {
    uid: "synthetic-developer",
    email: "developer@example.invalid",
  };
  const state = {
    auth: { currentUser: owner },
    authAgeMs: 360000,
    postId: "",
    events: [],
    toasts: [],
    instances: 0,
    unmounts: 0,
    onReauth: null,
    onStorage: null,
    onCompression: null,
    onUpload: null,
    onDelete: null,
    onUpdate: null,
    onSet: null,
    onGetDoc: null,
    posts: new Map(),
    active: null,
  };
  let currentHost = null;
  const sameDeps = (left, right) =>
    left &&
    right &&
    left.length === right.length &&
    left.every((item, index) => Object.is(item, right[index]));
  const React = {
    Fragment: "fragment",
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children },
    }),
    useState: (initial) => {
      const host = currentHost,
        index = host.cursor++;
      if (!host.slots[index])
        host.slots[index] = {
          value: typeof initial === "function" ? initial() : initial,
        };
      return [
        host.slots[index].value,
        (next) => {
          if (!host.mounted) return;
          const value =
            typeof next === "function" ? next(host.slots[index].value) : next;
          if (!Object.is(value, host.slots[index].value)) {
            host.slots[index].value = value;
            host.dirty = true;
          }
        },
      ];
    },
    useRef: (initial) => {
      const host = currentHost,
        index = host.cursor++;
      if (!host.slots[index]) host.slots[index] = { current: initial };
      return host.slots[index];
    },
    useMemo: (factory, deps) => {
      const host = currentHost,
        index = host.cursor++;
      if (!sameDeps(host.slots[index]?.deps, deps))
        host.slots[index] = { value: factory(), deps };
      return host.slots[index].value;
    },
    useEffect: (effect, deps) => {
      const host = currentHost,
        index = host.cursor++;
      if (!sameDeps(host.slots[index]?.deps, deps)) {
        const previous = host.slots[index];
        host.slots[index] = { deps, cleanup: previous?.cleanup };
        host.effects.push(() => {
          previous?.cleanup?.();
          host.slots[index].cleanup = effect();
        });
      }
    },
  };
  const react = { ...React, default: React };
  const navigate = (path) => {
    state.events.push({ kind: "navigate", path });
    state.postId = path.replace(/^\/developer-log\/?/, "");
    if (state.active) state.active.dirty = true;
  };
  const router = {
    useNavigate: () => navigate,
    useParams: () => ({ postId: state.postId || undefined }),
    Link: "Link",
    Navigate: "Navigate",
  };
  const pathRef = (...parts) => {
    const path = parts
      .filter((part) => part !== db)
      .map((part) => (typeof part === "string" ? part : part.path))
      .join("/");
    return { path, id: path.split("/").at(-1) };
  };
  const db = {};
  const recordWrite = (kind, ref, data) => {
    state.events.push({
      kind,
      ownerUid: state.auth.currentUser?.uid,
      ref,
      data,
    });
    if (state.authAgeMs > 300000)
      throw new Error("Synthetic recent-auth rule rejection");
  };
  let allocatedPostIds = 0;
  const firestore = {
    collection: pathRef,
    doc: (...parts) =>
      parts.length === 1
        ? pathRef(
            parts[0],
            ++allocatedPostIds === 1
              ? "post-created"
              : `post-created-${allocatedPostIds}`,
          )
        : pathRef(...parts),
    query: (value) => value,
    orderBy: () => ({}),
    limit: () => ({}),
    serverTimestamp: () => new Date(),
    onSnapshot: (_query, onValue) => {
      onValue({ docs: [] });
      return () => {};
    },
    getDoc: async (ref) => {
      const data = state.posts.get(ref.id);
      const snapshot = {
        id: ref.id,
        exists: () => Boolean(data),
        data: () => data,
      };
      await state.onGetDoc?.(ref);
      return snapshot;
    },
    setDoc: async (ref, data) => {
      recordWrite("create", ref, data);
      await state.onSet?.();
      state.posts.set(ref.id, plain(data));
    },
    updateDoc: async (ref, data) => {
      recordWrite("update", ref, data);
      await state.onUpdate?.();
      state.posts.set(ref.id, { ...state.posts.get(ref.id), ...plain(data) });
    },
    deleteDoc: async (ref) => {
      recordWrite("delete", ref);
      state.posts.delete(ref.id);
    },
    runTransaction: () => assert.fail("Unexpected like transaction"),
  };
  const stepUp = load("src/lib/stepUpReauth.ts", {});
  stepUp.registerStepUpReauthHandler(async (commandName) => {
    state.events.push({ kind: "reauth", commandName });
    await state.onReauth?.(commandName);
    state.authAgeMs = 0;
  });
  const globals = {
    URL: { createObjectURL: () => "blob:synthetic", revokeObjectURL() {} },
    Image: class {
      naturalWidth = 128;
      naturalHeight = 160;
      set src(_value) {
        queueMicrotask(() => this.onload());
      }
    },
    document: {
      createElement: (tag) =>
        tag === "canvas"
          ? {
              getContext: () => ({ fillRect() {}, drawImage() {} }),
              toBlob: (callback) => {
                Promise.resolve(state.onCompression?.()).then(() =>
                  callback(new Blob(["synthetic"], { type: "image/webp" })),
                );
              },
            }
          : {
              innerHTML: "",
              get textContent() {
                return this.innerHTML.replace(/<[^>]*>/g, "");
              },
            },
    },
  };
  const imageHelpers = load(
    "src/lib/developerLogImages.ts",
    {
      "./firebase": {
        auth: state.auth,
        getFirebaseStorage: async () => {
          await state.onStorage?.();
          return {};
        },
      },
      "./stepUpReauth": stepUp,
      "firebase/storage": {
        ref: (_storage, fullPath) => ({ fullPath }),
        uploadBytes: async (ref) => {
          state.events.push({
            kind: "storage-upload",
            ownerUid: state.auth.currentUser?.uid,
            ref,
          });
          await state.onUpload?.();
        },
        deleteObject: async (ref) => {
          state.events.push({
            kind: "storage-delete",
            ownerUid: state.auth.currentUser?.uid,
            ref,
          });
          await state.onDelete?.();
        },
        getDownloadURL: async (ref) =>
          `https://example.invalid/${ref.fullPath}`,
      },
    },
    globals,
  );
  const showToast = (value) => state.toasts.push(value);
  const DeveloperLog = load(
    "src/pages/DeveloperLog.tsx",
    {
      react,
      "react-router-dom": router,
      "firebase/firestore": firestore,
      "../lib/firebase": { auth: state.auth, db },
      "../lib/stepUpReauth": stepUp,
      "../contexts/AuthContext": {
        useAuth: () => ({
          currentUser: state.auth.currentUser,
          userData: { name: "Synthetic developer", role: "teacher" },
        }),
      },
      "../components/common/AppToastProvider": {
        useAppToast: () => ({ showToast }),
      },
      "../components/common/LoadingState": {
        PageLoading: "PageLoading",
        InlineLoading: "InlineLoading",
      },
      "../components/common/QuillEditor": { default: "QuillEditor" },
      "../lib/developerLogs": load("src/lib/developerLogs.ts", {}),
      "../lib/developerLogImages": imageHelpers,
      "../lib/permissions": {
        isDeveloperUser: (email) => email === owner.email,
      },
    },
    { ...globals, window: { confirm: () => true } },
  ).default;
  const { ProtectedAccessBoundary } = load(
    "src/components/auth/ProtectedAccessBoundary.tsx",
    {
      react,
      "react-router-dom": router,
      "../common/StatePanel": { default: "StatePanel" },
    },
  );
  const flush = () => {
    let remaining = 50;
    while (state.active?.dirty) {
      assert.ok(remaining-- > 0, "Component effects must settle");
      const host = state.active;
      host.dirty = false;
      host.cursor = 0;
      host.effects = [];
      currentHost = host;
      host.tree = DeveloperLog();
      currentHost = null;
      host.effects.forEach((effect) => effect());
    }
  };
  const setAccess = (status) => {
    const boundary = ProtectedAccessBoundary({
      decision: { status },
      children: React.createElement(DeveloperLog),
    });
    const retained = allNodes(boundary).some(
      (node) => node.type === DeveloperLog,
    );
    if (!retained && state.active) {
      const host = state.active;
      host.mounted = false;
      host.slots.forEach((slot) => slot.cleanup?.());
      state.active = null;
      state.unmounts++;
    }
    if (retained && !state.active) {
      state.instances++;
      state.active = {
        mounted: true,
        dirty: true,
        slots: [],
        cursor: 0,
        effects: [],
        tree: null,
      };
    }
    flush();
  };
  const until = async (predicate) => {
    const deadline = Date.now() + 5000;
    do {
      await new Promise((resolve) => setImmediate(resolve));
      flush();
      if (predicate()) return;
    } while (Date.now() < deadline);
    assert.fail(
      `Fixture did not settle: ${JSON.stringify(state.events.map((event) => event.kind))}`,
    );
  };
  const node = (predicate) => allNodes(state.active?.tree).find(predicate);
  const button = (label) =>
    node((item) => item.type === "button" && text(item).trim() === label);
  // Native disabled fieldsets stop user input before React handlers run.
  const isDisabled = (target, tree = state.active?.tree, inherited = false) => {
    if (!tree || typeof tree !== "object") return false;
    if (Array.isArray(tree))
      return tree.some((child) => isDisabled(target, child ?? null, inherited));
    const disabled = inherited || Boolean(tree.props?.disabled);
    if (tree === target) return disabled;
    return isDisabled(target, tree.props?.children ?? null, disabled);
  };
  const click = (label) => {
    const target = button(label);
    assert.ok(target, `Button ${label} exists`);
    if (!isDisabled(target)) target.props.onClick();
    flush();
  };
  const input = (id, value) => {
    const target = node((item) => item.props?.id === id);
    assert.ok(target, `Input ${id} exists`);
    if (!isDisabled(target)) target.props.onChange({ target: { value } });
    flush();
  };
  const file = Object.assign(
    new Blob(["synthetic file"], { type: "image/png" }),
    { name: "draft.png" },
  );
  const addImage = () => {
    node(
      (item) => item.type === "input" && item.props.type === "file",
    ).props.onChange({ target: { files: [file] }, currentTarget: {} });
    flush();
  };
  const openEditor = async (editing = false, images = []) => {
    if (editing) {
      state.postId = "post-existing";
      state.posts.set(state.postId, {
        title: "Original title",
        summary: "Original summary",
        bodyHtml: "Original body",
        category: "feature",
        images,
        publishedAt: new Date(),
      });
    }
    setAccess("AUTHORIZED");
    if (editing) {
      await until(() => Boolean(button("수정")));
      click("수정");
    } else click("글쓰기");
    input("developer-log-title", "Unsaved title");
    input("developer-log-summary", "Unsaved summary");
  };
  const save = () => click(button("수정 저장") ? "수정 저장" : "게시하기");
  const changeOwner = () => {
    state.auth.currentUser = {
      uid: "another-user",
      email: "another@example.invalid",
    };
  };
  return {
    state,
    owner,
    file,
    imageHelpers,
    stepUp,
    setAccess,
    until,
    flush,
    node,
    button,
    isDisabled,
    click,
    input,
    addImage,
    openEditor,
    save,
    changeOwner,
  };
};

let checks = 0;
const writes = (state) =>
  state.events.filter((event) =>
    ["create", "update", "delete", "storage-upload", "storage-delete"].includes(
      event.kind,
    ),
  );

for (const editing of [false, true]) {
  const test = fixture();
  await test.openEditor(editing);
  test.save();
  await test.until(() =>
    test.state.toasts.some((toast) => toast.tone === "success"),
  );
  assert.deepEqual(
    writes(test.state).map((event) => event.kind),
    editing ? ["update"] : ["create"],
  );
  await test.until(() =>
    text(test.state.active.tree).includes("Unsaved title"),
  );
  assert.match(text(test.state.active.tree), /Unsaved title/);
  checks++;
}

for (const editing of [false, true]) {
  for (const outcome of ["success", "cancelled", "write-failed"]) {
    const test = fixture();
    await test.openEditor(editing);
    test.addImage();
    const gate = deferred();
    let first = true;
    test.state.onReauth = async () => {
      if (!first) return;
      first = false;
      test.setAccess("AUTHENTICATING");
      await gate.promise;
      test.setAccess("AUTHORIZED");
      if (outcome === "cancelled")
        throw new Error("Synthetic cancellation after remount");
    };
    if (outcome === "write-failed")
      test.state[editing ? "onUpdate" : "onSet"] = () => {
        throw new Error("Synthetic server rejection");
      };
    test.save();
    assert.equal(
      test.state.active,
      null,
      "The actual protected boundary removed the old page",
    );
    gate.resolve();
    await test.until(() =>
      test.state.toasts.some(
        (toast) => toast.tone === (outcome === "success" ? "success" : "error"),
      ),
    );
    assert.equal(test.state.instances, 2);
    assert.equal(test.state.unmounts, 1);
    if (outcome === "success") {
      await test.until(() =>
        text(test.state.active.tree).includes("Unsaved title"),
      );
      assert.match(text(test.state.active.tree), /Unsaved title/);
      assert.equal(
        test.node((item) => item.props?.id === "developer-log-title"),
        undefined,
      );
      assert.equal(
        test.state.postId,
        editing ? "post-existing" : "post-created",
      );
    } else {
      assert.equal(
        test.node((item) => item.props?.id === "developer-log-title").props
          .value,
        "Unsaved title",
      );
      assert.equal(
        test.node((item) => item.props?.id === "developer-log-summary").props
          .value,
        "Unsaved summary",
      );
      assert.match(text(test.state.active.tree), /미리보기 목록 1\/20/);
      assert.ok(test.button(editing ? "수정 저장" : "게시하기"));
    }
    checks++;
  }
}

{
  const test = fixture();
  await test.openEditor(true);
  test.addImage();
  test.state.onReauth = async () => {
    test.setAccess("AUTHENTICATING");
    test.changeOwner();
    test.setAccess("AUTHORIZED");
  };
  test.save();
  await test.until(
    () =>
      test.state.instances === 2 &&
      !test.node((item) => item.props?.id === "developer-log-title"),
  );
  assert.equal(writes(test.state).length, 0);
  assert.doesNotMatch(text(test.state.active.tree), /Unsaved title/);
  test.setAccess("AUTHENTICATING");
  test.state.auth.currentUser = test.owner;
  test.setAccess("AUTHORIZED");
  await test.until(() =>
    test.state.toasts.some((toast) => toast.tone === "error"),
  );
  assert.equal(
    test.node((item) => item.props?.id === "developer-log-title").props.value,
    "Unsaved title",
  );
  checks++;
}

for (const cancelled of [false, true]) {
  const test = fixture();
  await test.openEditor(true);
  test.click("취소");
  await test.until(() => Boolean(test.button("삭제")));
  test.state.onReauth = async () => {
    test.setAccess("AUTHENTICATING");
    test.setAccess("AUTHORIZED");
    if (cancelled) throw new Error("Synthetic cancellation");
  };
  test.click("삭제");
  await test.until(() =>
    test.state.toasts.some(
      (toast) => toast.tone === (cancelled ? "error" : "success"),
    ),
  );
  assert.equal(
    writes(test.state).filter((event) => event.kind === "delete").length,
    cancelled ? 0 : 1,
  );
  assert.equal(test.state.instances, 2);
  checks++;
}

for (const boundary of ["compression", "storage", "upload"]) {
  const test = fixture();
  await test.openEditor(true);
  test.addImage();
  test.state[
    { compression: "onCompression", storage: "onStorage", upload: "onUpload" }[
      boundary
    ]
  ] = test.changeOwner;
  test.save();
  await test.until(() =>
    test.state.events.some((event) => event.kind === "reauth"),
  );
  for (let tick = 0; tick < 4; tick++)
    await new Promise((resolve) => setImmediate(resolve));
  const attempts = writes(test.state);
  assert.equal(attempts.filter((event) => event.kind === "update").length, 0);
  assert.equal(
    attempts.filter((event) => event.kind === "storage-upload").length,
    boundary === "upload" ? 1 : 0,
  );
  assert.ok(attempts.every((event) => event.ownerUid === test.owner.uid));
  checks++;
}

for (const operation of ["upload", "delete"]) {
  for (const boundary of ["before", "storage"]) {
    const test = fixture();
    if (boundary === "before") test.changeOwner();
    else test.state.onStorage = test.changeOwner;
    const promise =
      operation === "upload"
        ? test.imageHelpers.uploadDeveloperLogImage({
            postId: "synthetic",
            file: test.file,
            expectedUid: test.owner.uid,
          })
        : test.imageHelpers.tryDeleteDeveloperLogImage(
            "developer_log_images/synthetic/image.webp",
            test.owner.uid,
          );
    await assert.rejects(promise, (error) => error.code === "IDENTITY_CHANGED");
    assert.equal(writes(test.state).length, 0);
    checks++;
  }
}

{
  const test = fixture();
  await test.openEditor(true);
  test.addImage();
  test.state.onUpload = () => {
    test.state.authAgeMs = 360000;
  };
  test.save();
  await test.until(() =>
    test.state.toasts.some((toast) => toast.tone === "success"),
  );
  assert.equal(
    test.state.events.filter((event) => event.kind === "reauth").length,
    2,
  );
  assert.ok(
    writes(test.state).every((event) => event.ownerUid === test.owner.uid),
  );
  checks++;
}

for (const action of ["save", "delete"]) {
  const test = fixture();
  const oldImage = {
    imageUrl: "https://example.invalid/old.webp",
    imageStoragePath: "developer_log_images/post-existing/old.webp",
  };
  await test.openEditor(true, [oldImage]);
  test.state.onDelete = () => {
    throw new test.stepUp.StepUpReauthError(
      "IDENTITY_CHANGED",
      "Synthetic cleanup interruption",
    );
  };
  if (action === "save") {
    test
      .node((item) => item.props?.["aria-label"] === "기존 이미지 제거")
      .props.onClick();
    test.flush();
    test.addImage();
    test.save();
  } else {
    test.click("취소");
    await test.until(() => Boolean(test.button("삭제")));
    test.click("삭제");
  }
  await test.until(() =>
    test.state.toasts.some((toast) => toast.tone === "success"),
  );
  assert.deepEqual(
    writes(test.state)
      .filter((event) => event.kind === "storage-delete")
      .map((event) => event.ref.fullPath),
    [oldImage.imageStoragePath],
    "Cleanup failures must not roll back committed attachments",
  );
  assert.equal(
    test.state.toasts.filter((toast) => toast.tone === "error").length,
    0,
  );
  checks++;
}

{
  const test = fixture();
  await test.openEditor(true);
  test.addImage();
  test.state.onUpdate = () => {
    test.setAccess("AUTHENTICATING");
    test.changeOwner();
    test.setAccess("AUTHORIZED");
  };
  test.save();
  await test.until(() => test.state.instances === 2);
  assert.ok(
    writes(test.state).every((event) => event.ownerUid === test.owner.uid),
  );
  assert.equal(test.state.toasts.length, 0);
  test.setAccess("AUTHENTICATING");
  test.state.auth.currentUser = test.owner;
  test.setAccess("AUTHORIZED");
  await test.until(() =>
    test.state.toasts.some((toast) => toast.tone === "success"),
  );
  assert.equal(
    writes(test.state).filter((event) => event.kind === "storage-delete")
      .length,
    0,
  );
  checks++;
}

for (const editing of [false, true]) {
  const test = fixture();
  await test.openEditor(editing);
  test.addImage();
  const originalBody = test.node((item) => item.type === "QuillEditor").props
    .value;
  const upload = deferred();
  test.state.onUpload = () => upload.promise;
  test.save();
  await test.until(() =>
    test.state.events.some((event) => event.kind === "storage-upload"),
  );
  const fieldset = test.node((item) => item.type === "fieldset");
  assert.equal(fieldset.props.disabled, true);
  assert.equal(fieldset.props["aria-busy"], true);
  const controls = allNodes(fieldset).filter((item) =>
    ["input", "textarea", "button", "select"].includes(item.type),
  );
  assert.ok(controls.length > 5);
  assert.ok(controls.every((item) => test.isDisabled(item)));
  const editorBoundary = test.node(
    (item) =>
      item.props?.["aria-disabled"] === true &&
      typeof item.props?.ref === "function",
  );
  const inertCalls = [];
  editorBoundary.props.ref({
    toggleAttribute: (...args) => inertCalls.push(args),
  });
  assert.deepEqual(inertCalls, [["inert", true]]);
  test.input("developer-log-title", "Must not replace the pending title");
  test.input("developer-log-summary", "Must not replace the pending summary");
  test.click("취소");
  // Queued editor callbacks and file pickers also obey the pending guard.
  test
    .node((item) => item.type === "QuillEditor")
    .props.onChange("Late editor event");
  test.addImage();
  test.flush();
  assert.equal(
    test.node((item) => item.type === "QuillEditor").props.value,
    originalBody,
  );
  assert.match(text(test.state.active.tree), /미리보기 목록 1\/20/);
  upload.reject(new Error("Synthetic upload failure"));
  await test.until(() =>
    test.state.toasts.some((toast) => toast.tone === "error"),
  );
  assert.equal(
    test.node((item) => item.props?.id === "developer-log-title").props.value,
    "Unsaved title",
  );
  assert.equal(
    test.node((item) => item.props?.id === "developer-log-summary").props.value,
    "Unsaved summary",
  );
  assert.equal(
    test.node((item) => item.type === "QuillEditor").props.value,
    originalBody,
  );
  assert.match(text(test.state.active.tree), /미리보기 목록 1\/20/);
  assert.equal(
    test.node((item) => item.type === "fieldset").props.disabled,
    false,
  );
  test.input("developer-log-title", "Retry title");
  assert.equal(
    test.node((item) => item.props?.id === "developer-log-title").props.value,
    "Retry title",
  );
  test.node((item) => item.type === "QuillEditor").props.onChange("Retry body");
  test.flush();
  assert.equal(
    test.node((item) => item.type === "QuillEditor").props.value,
    "Retry body",
  );
  checks++;
}

for (const failure of ["upload", "publish"]) {
  const test = fixture();
  await test.openEditor();
  test.addImage();
  const gate = deferred();
  test.state.onUpload = () => gate.promise;
  if (failure === "publish") {
    test.state.onSet = () => {
      throw new Error("Synthetic publish rejection");
    };
  }
  test.save();
  await test.until(() =>
    test.state.events.some((event) => event.kind === "storage-upload"),
  );
  assert.equal(
    test.state.posts.size,
    0,
    "A pending attachment must not publish an incomplete post",
  );
  assert.equal(
    writes(test.state).filter((event) => event.kind === "create").length,
    0,
  );
  if (failure === "upload")
    gate.reject(new Error("Synthetic attachment rejection"));
  else gate.resolve();
  await test.until(() =>
    test.state.toasts.some((toast) => toast.tone === "error"),
  );
  assert.equal(
    test.state.posts.size,
    0,
    "A rejected save must not leave an incomplete post",
  );
  assert.match(text(test.state.active.tree), /미리보기 목록 1\/20/);
  test.state.onUpload = null;
  test.state.onSet = null;
  test.save();
  await test.until(() =>
    test.state.toasts.some((toast) => toast.tone === "success"),
  );
  assert.equal(
    test.state.posts.size,
    1,
    "Retry must publish exactly one complete post",
  );
  const post = [...test.state.posts.values()][0];
  assert.equal(post.title, "Unsaved title");
  assert.equal(post.images.length, 1);
  assert.equal(post.createdBy, test.owner.uid);
  assert.ok(post.publishedAt);
  checks++;
}

console.log(
  `Developer log save reauthentication: ${checks} checks passed (actual page unmount/remount and Storage helpers).`,
);
