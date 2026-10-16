import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as geography from "d3-geo";

// Exercise the production renderer with real d3 projections and a small DOM/RAF
// fixture. No browser, network, backend, or new test dependency is required.
const compile = (file) =>
  ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
const rendererCode = compile(
  "src/components/public-entry/entryMapMotionRenderer.ts",
);
const componentCode = compile("src/components/public-entry/EntryMapMotion.tsx");
const line = {
  type: "LineString",
  coordinates: [
    [0, 0],
    [40, 20],
    [80, 30],
    [120, 20],
  ],
};
const data = {
  land: line,
  borders: line,
  disputedBorders: line,
  rivers: line,
  deserts: line,
  nile: {
    type: "LineString",
    coordinates: [
      [31, 10],
      [30, 20],
      [31, 30],
    ],
  },
  labels: [
    { name: "인도양", coordinates: [70, -10], minZoom: 1, kind: "ocean" },
  ],
};

class Events {
  listeners = new Map();
  addEventListener(type, handler, options = false) {
    const capture =
      typeof options === "boolean" ? options : Boolean(options.capture);
    const key = `${type}:${capture}`;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(handler);
  }
  removeEventListener(type, handler, options = false) {
    const capture =
      typeof options === "boolean" ? options : Boolean(options.capture);
    this.listeners.get(`${type}:${capture}`)?.delete(handler);
  }
  dispatch(type) {
    for (const capture of [true, false])
      for (const handler of [
        ...(this.listeners.get(`${type}:${capture}`) || []),
      ])
        handler({ currentTarget: this, target: this, type });
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

class Element extends Events {
  constructor(tag = "div", className = "", dataset = {}) {
    super();
    Object.assign(this, {
      tag,
      className,
      dataset,
      style: {},
      attributes: new Map(),
      children: [],
      parent: null,
      textContent: "",
      disabled: false,
      clientWidth: 1100,
      clientHeight: 600,
      offsetLeft: 700,
      offsetTop: 250,
      offsetWidth: 300,
      offsetHeight: 200,
      rect: {
        top: 100,
        left: 0,
        right: 1100,
        bottom: 700,
        width: 1100,
        height: 600,
      },
    });
  }
  append(...children) {
    children.forEach((child) => {
      child.parent = this;
      this.children.push(child);
    });
  }
  replaceChildren(...children) {
    this.children.forEach((child) => {
      child.parent = null;
    });
    this.children = [];
    this.append(...children);
  }
  setAttribute(key, value) {
    this.attributes.set(key, String(value));
  }
  getAttribute(key) {
    return this.attributes.get(key) ?? null;
  }
  getBoundingClientRect() {
    return this.rect;
  }
  matches(selector) {
    if (selector.startsWith("."))
      return this.className.split(" ").includes(selector.slice(1));
    const match = selector.match(/^\[data-([\w-]+)(?:="([^"]+)")?\]$/);
    if (match) {
      const key = match[1].replace(/-([a-z])/g, (_, letter) =>
        letter.toUpperCase(),
      );
      return (
        key in this.dataset &&
        (match[2] === undefined || this.dataset[key] === match[2])
      );
    }
    return this.tag === selector;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  closest(selector) {
    return this.matches(selector)
      ? this
      : (this.parent?.closest(selector) ?? null);
  }
}

function fixture(options = {}) {
  const root = new Element("div", "entry-map-motion");
  const stage = new Element("div", "entry-map-motion__stage");
  const svg = new Element("svg", "entry-map-motion__map");
  const detail = new Element("article", "entry-map-motion__detail");
  const toggle = new Element("button", "", { mapToggle: "" });
  const announcement = new Element("span", "entry-map-motion__announcement");
  const buttons = ["globe", "hanyang", "nile"].map((mapScene) => {
    const button = new Element("button", "", { mapScene });
    button.textContent = { globe: "지구본", hanyang: "한양", nile: "나일강" }[
      mapScene
    ];
    return button;
  });
  root.append(stage, toggle, announcement, ...buttons);
  stage.append(svg, detail);
  for (const name of ["name", "location", "definition", "era", "story"])
    detail.append(
      new Element("span", "", {
        [`map${name[0].toUpperCase()}${name.slice(1)}`]: "",
      }),
    );
  const layers = {};
  for (const name of [
    "ocean",
    "grid",
    "land",
    "desert",
    "borders",
    "disputed",
    "rivers",
    "river-selected",
    "river-halo",
    "shade",
    "viewport",
    "selection",
    "badge",
    "labels",
  ]) {
    layers[name] = new Element("path", "", { mapLayer: name });
    svg.append(layers[name]);
  }
  layers.badge.append(new Element("text"), new Element("rect"));
  layers.selection.append(
    new Element("circle", "entry-map-motion__ripple"),
    new Element("circle", "entry-map-motion__ripple"),
  );
  if (options.offscreen) root.rect = { ...root.rect, top: 1200, bottom: 1800 };
  const window = Object.assign(new Events(), {
    innerWidth: 1200,
    innerHeight: 900,
  });
  const document = Object.assign(new Events(), {
    hidden: false,
    documentElement: { clientWidth: 1200, clientHeight: 900 },
    createElementNS: (_, tag) => new Element(tag),
  });
  const media = Object.assign(new Events(), {
    matches: options.reduced ?? false,
  });
  if (options.media === "legacy") {
    media.addListener = (handler) =>
      Events.prototype.addEventListener.call(media, "change", handler);
    media.removeListener = (handler) =>
      Events.prototype.removeEventListener.call(media, "change", handler);
    media.addEventListener = undefined;
    media.removeEventListener = undefined;
  }
  const frames = new Map();
  let now = 1000,
    nextFrame = 0;
  const context = {
    exports: {},
    window,
    document,
    console,
    requestAnimationFrame: (callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  };
  if (options.media !== "absent") context.matchMedia = () => media;
  const intersections = [],
    resizes = [];
  function observerType(list) {
    return class {
      targets = new Set();
      constructor(callback) {
        this.callback = callback;
        list.push(this);
      }
      observe(target) {
        this.targets.add(target);
      }
      disconnect() {
        this.targets.clear();
      }
      fire(target, values = {}) {
        if (this.targets.has(target)) this.callback([{ target, ...values }]);
      }
    };
  }
  if (options.intersection !== false)
    context.IntersectionObserver = observerType(intersections);
  if (options.resize !== false) context.ResizeObserver = observerType(resizes);
  Object.assign(window, context);
  const fetches = [];
  let failAssets = false;
  context.fetch = async (url) => {
    fetches.push(url);
    return {
      ok: !failAssets,
      json: async () =>
        url.includes("globe-geography")
          ? data
          : url.includes("map-nile")
            ? data.nile
            : data.land,
    };
  };
  context.require = (name) => {
    if (name === "d3-geo") return geography;
    if (name.endsWith("?url")) return { default: name };
    throw new Error(`Unexpected renderer dependency: ${name}`);
  };
  vm.createContext(context);
  vm.runInContext(rendererCode, context);
  const runtime = {
    ...context.exports,
    context,
    root,
    stage,
    svg,
    layers,
    toggle,
    buttons,
    announcement,
    window,
    document,
    media,
    frames,
    intersections,
    resizes,
    fetches,
    failAssets: (value) => {
      failAssets = value;
    },
    intersect(value) {
      root.rect = {
        ...root.rect,
        top: value ? 100 : 1200,
        bottom: value ? 700 : 1800,
      };
      intersections.forEach((observer) =>
        observer.fire(root, {
          isIntersecting: value,
          intersectionRatio: value ? 1 : 0,
        }),
      );
      window.dispatch("scroll");
    },
    advance(count = 15, delta = 40) {
      for (let index = 0; index < count; index++) {
        now += delta;
        const current = [...frames.entries()];
        current.forEach(([id]) => frames.delete(id));
        current.forEach(([, callback]) => callback(now));
      }
    },
    resizeTo(width, height) {
      stage.clientWidth = width;
      stage.clientHeight = height;
      resizes.forEach((observer) => observer.fire(stage));
      window.dispatch("resize");
    },
    listenerCount() {
      return [window, document, media, toggle, ...buttons].reduce(
        (total, target) => total + target.listenerCount,
        0,
      );
    },
  };
  runtime.mount = (enabled = true) => {
    const controller = runtime.mountEntryMapMotion(root, data, enabled);
    runtime.intersect(!options.offscreen);
    return controller;
  };
  return runtime;
}

function assertMoving(runtime) {
  assert.equal(runtime.root.dataset.playing, "true");
  assert.equal(runtime.toggle.disabled, false);
  assert.equal(runtime.frames.size, 1, "Exactly one active animation loop");
  const time = runtime.root.dataset.time;
  const path = runtime.layers.land.getAttribute("d");
  assert.ok(path?.length, "Actual d3 geometry must be rendered");
  runtime.advance();
  assert.notEqual(
    runtime.root.dataset.time,
    time,
    "Elapsed animation time must advance",
  );
  assert.notEqual(
    runtime.layers.land.getAttribute("d"),
    path,
    "Actual SVG geography must rotate",
  );
  assert.equal(runtime.frames.size, 1, "Frames must not multiply");
}

function assertStopped(runtime) {
  assert.equal(runtime.root.dataset.playing, "false");
  assert.equal(runtime.frames.size, 0, "Stopped playback must cancel its RAF");
  const time = runtime.root.dataset.time;
  const path = runtime.layers.land.getAttribute("d");
  runtime.advance(5);
  assert.equal(runtime.root.dataset.time, time);
  assert.equal(runtime.layers.land.getAttribute("d"), path);
}

function assertDisposed(runtime, controller) {
  controller.dispose();
  assert.equal(runtime.frames.size, 0);
  assert.equal(
    runtime.listenerCount(),
    0,
    "All event listeners must be removed",
  );
  assert.ok(
    [...runtime.intersections, ...runtime.resizes].every(
      (observer) => observer.targets.size === 0,
    ),
  );
  assert.equal(runtime.layers.labels.children.length, 0);
  const time = runtime.root.dataset.time;
  runtime.intersect(true);
  runtime.window.dispatch("resize");
  runtime.document.dispatch("visibilitychange");
  runtime.toggle.dispatch("click");
  runtime.advance();
  assert.equal(runtime.frames.size, 0);
  assert.equal(runtime.root.dataset.time, time);
}

for (const media of ["modern", "legacy", "absent"])
  for (const reduced of [false, true]) {
    const runtime = fixture({ media, reduced });
    const controller = runtime.mount();
    assertMoving(runtime);
    runtime.media.matches = !reduced;
    runtime.media.dispatch("change");
    assertMoving(runtime);
    assertDisposed(runtime, controller);
  }
console.log(
  "PASS autoplay and real SVG rotation with reduced motion on/off, legacy MediaQueryList, and absent matchMedia",
);

{
  const runtime = fixture({ reduced: true });
  const controller = runtime.mount();
  runtime.toggle.dispatch("click");
  assertStopped(runtime);
  assert.equal(runtime.toggle.textContent, "재생");
  runtime.intersect(false);
  runtime.intersect(true);
  runtime.document.hidden = true;
  runtime.document.dispatch("visibilitychange");
  runtime.document.hidden = false;
  runtime.document.dispatch("visibilitychange");
  assertStopped(runtime);
  runtime.toggle.dispatch("click");
  assertMoving(runtime);
  for (const button of runtime.buttons) {
    button.dispatch("click");
    assertStopped(runtime);
    assert.equal(runtime.root.dataset.scene, button.dataset.mapScene);
    assert.equal(button.getAttribute("aria-pressed"), "true");
    assert.match(runtime.announcement.textContent, /재생이 일시정지되었습니다/);
  }
  controller.setEnabled(false);
  assert.equal(runtime.toggle.disabled, true);
  controller.setEnabled(true);
  assertStopped(runtime);
  runtime.buttons[0].dispatch("click");
  runtime.toggle.dispatch("click");
  assertMoving(runtime);
  controller.setEnabled(false);
  assertStopped(runtime);
  assert.equal(runtime.toggle.textContent, "모션 OFF");
  controller.setEnabled(true);
  assertMoving(runtime);
  assertDisposed(runtime, controller);
}
console.log(
  "PASS manual pause/resume, all scene selections, and site motion OFF/ON preserve user intent",
);

for (const intersection of [true, false])
  for (const resize of [true, false]) {
    const runtime = fixture({ intersection, resize, reduced: true });
    const controller = runtime.mount();
    assertMoving(runtime);
    runtime.document.hidden = true;
    runtime.document.dispatch("visibilitychange");
    assertStopped(runtime);
    runtime.document.hidden = false;
    runtime.document.dispatch("visibilitychange");
    assertMoving(runtime);
    runtime.intersect(false);
    assertStopped(runtime);
    runtime.intersect(true);
    assertMoving(runtime);
    runtime.toggle.dispatch("click");
    const oldPath = runtime.layers.land.getAttribute("d");
    runtime.resizeTo(390, 700);
    assert.equal(runtime.svg.getAttribute("viewBox"), "0 0 390 700");
    assert.notEqual(
      runtime.layers.land.getAttribute("d"),
      oldPath,
      "Resize must recompute actual projection even while paused",
    );
    assertStopped(runtime);
    assertDisposed(runtime, controller);
  }
console.log(
  "PASS hidden-tab, viewport reentry, mobile resize, and cleanup with every IntersectionObserver/ResizeObserver combination",
);

for (const intersection of [true, false]) {
  const runtime = fixture({ intersection, resize: false, offscreen: true });
  const controller = runtime.mount();
  assertStopped(runtime);
  runtime.intersect(true);
  assertMoving(runtime);
  assertDisposed(runtime, controller);
}
{
  const runtime = fixture({ intersection: false, resize: false });
  const controller = runtime.mount(false);
  assertStopped(runtime);
  assert.ok(runtime.layers.land.getAttribute("d"));
  controller.setEnabled(true);
  runtime.buttons[0].dispatch("click");
  runtime.toggle.dispatch("click");
  assertMoving(runtime);
  assertDisposed(runtime, controller);
}
console.log(
  "PASS initially offscreen or disabled map renders safely and resumes on demand",
);

for (const intersection of [true, false]) {
  const runtime = fixture({ intersection, resize: false });
  runtime.stage.clientWidth = 0;
  runtime.stage.clientHeight = 0;
  const controller = runtime.mount();
  assert.equal(
    runtime.frames.size,
    0,
    "A zero-size map must not waste animation frames",
  );
  runtime.stage.clientWidth = 1100;
  runtime.stage.clientHeight = 600;
  runtime.window.dispatch("pageshow");
  assertMoving(runtime);
  runtime.resizeTo(0, 0);
  assert.equal(runtime.frames.size, 0);
  runtime.stage.clientWidth = 390;
  runtime.stage.clientHeight = 700;
  runtime.window.dispatch("pageshow");
  assert.equal(runtime.svg.getAttribute("viewBox"), "0 0 390 700");
  assertMoving(runtime);
  const before = Number(runtime.root.dataset.time);
  runtime.advance(1, 600_000);
  assert.ok(
    Number(runtime.root.dataset.time) - before <= 0.11,
    "A suspended frame must not jump through the story",
  );
  assertDisposed(runtime, controller);
}
console.log(
  "PASS zero-size mount/resize and cached-page pageshow recover playback without long-frame time jumps",
);

// Render the actual TSX using minimal React hooks. Effects, state transitions,
// dependency cleanup, JSX button handlers, and async renderer imports execute.
function component(runtime) {
  const slots = [];
  let cursor = 0,
    dirty = true,
    tree,
    enabled = true,
    mounted = true;
  let effects = [];
  const hook = (initial) => {
    const index = cursor++;
    if (!slots[index]) slots[index] = initial();
    return slots[index];
  };
  const react = {
    useRef: (value) => hook(() => ({ current: value })),
    useId: () => ":entry-map-test:",
    useState: (value) => {
      const state = hook(() => ({ value }));
      return [
        state.value,
        (next) => {
          const value = typeof next === "function" ? next(state.value) : next;
          if (value !== state.value) {
            state.value = value;
            dirty = true;
          }
        },
      ];
    },
    useEffect: (callback, deps) => {
      const effect = hook(() => ({}));
      if (
        !effect.deps ||
        deps.some((value, index) => value !== effect.deps[index])
      ) {
        effect.deps = [...deps];
        effects.push(() => {
          effect.cleanup?.();
          effect.cleanup = callback();
        });
      }
    },
  };
  const jsx = (type, props) => {
    if (props?.ref) props.ref.current = runtime.root;
    return { type, props: props || {} };
  };
  const exports = {};
  vm.runInNewContext(componentCode, {
    ...runtime.context,
    exports,
    require: (name) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime")
        return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "./EntryMotionContext")
        return { useEntryMotionEnabled: () => enabled };
      if (name === "./entryMapMotionRenderer") return runtime;
      if (name.endsWith(".css")) return {};
      throw new Error(`Unexpected component dependency: ${name}`);
    },
  });
  const render = () => {
    dirty = false;
    cursor = 0;
    tree = exports.default();
    const pending = effects;
    effects = [];
    pending.forEach((effect) => effect());
  };
  render();
  return {
    async flush() {
      for (let pass = 0; pass < 15; pass++) {
        await Promise.resolve();
        if (dirty && mounted) render();
      }
    },
    find(predicate) {
      const walk = (node) => {
        if (!node || typeof node !== "object") return null;
        if (predicate(node)) return node;
        const children = [node.props?.children].flat(Infinity);
        for (const child of children) {
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return walk(tree);
    },
    setEnabled(value) {
      enabled = value;
      dirty = true;
    },
    dispose() {
      mounted = false;
      slots.forEach((slot) => slot.cleanup?.());
    },
  };
}

{
  const runtime = fixture({
    intersection: false,
    resize: false,
    media: "legacy",
    reduced: true,
  });
  runtime.failAssets(true);
  const view = component(runtime);
  await view.flush();
  assert.ok(
    view.find((node) => node.props.role === "alert"),
    "Failed map assets must show retry UI",
  );
  const retry = view.find(
    (node) => node.type === "button" && node.props.children === "다시 불러오기",
  );
  assert.ok(retry);
  assert.equal(runtime.frames.size, 0);
  assert.equal(runtime.fetches.length, 3);
  runtime.failAssets(false);
  retry.props.onClick();
  await view.flush();
  assert.equal(
    runtime.fetches.length,
    6,
    "Retry must clear the rejected asset cache and fetch again",
  );
  assert.equal(
    view.find((node) => node.props.role === "alert"),
    null,
  );
  assert.equal(
    view.find((node) => node.props.className === "entry-map-motion__stage")
      .props["aria-busy"],
    false,
  );
  assertMoving(runtime);
  view.setEnabled(false);
  await view.flush();
  assertStopped(runtime);
  view.setEnabled(true);
  await view.flush();
  assertMoving(runtime);
  view.dispose();
  assert.equal(runtime.frames.size, 0);
  assert.equal(runtime.listenerCount(), 0);
  const secondView = component(runtime);
  await secondView.flush();
  assert.equal(
    runtime.fetches.length,
    6,
    "Successful assets are reused on remount",
  );
  assertMoving(runtime);
  secondView.dispose();
  assert.equal(runtime.frames.size, 0);
  assert.equal(runtime.listenerCount(), 0);
}
console.log(
  "PASS actual TSX loads without IntersectionObserver, retries failed assets, follows site toggle, and remounts cleanly",
);

{
  const runtime = fixture();
  const view = component(runtime);
  await view.flush();
  assert.equal(
    runtime.fetches.length,
    0,
    "Supported browsers retain lazy loading",
  );
  runtime.intersect(true);
  await view.flush();
  runtime.intersect(true);
  assertMoving(runtime);
  view.dispose();
  assert.equal(runtime.frames.size, 0);
  assert.equal(runtime.listenerCount(), 0);
  assert.ok(
    runtime.intersections.every((observer) => observer.targets.size === 0),
  );
}
{
  const runtime = fixture({ intersection: false, resize: false });
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  runtime.loadEntryMapMotion = () => pending;
  const abandoned = component(runtime);
  await abandoned.flush();
  abandoned.dispose();
  finish(data);
  await abandoned.flush();
  assert.equal(
    runtime.frames.size,
    0,
    "An unmounted async load must not start playback",
  );
  assert.equal(runtime.listenerCount(), 0);
  assert.equal(runtime.layers.labels.children.length, 0);
}
console.log(
  "PASS lazy loading and unmount during pending assets leave no animation or listeners",
);
console.log("Entry map motion: all lifecycle and compatibility checks passed.");
