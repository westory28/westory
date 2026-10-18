import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
async function bundle(path) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    external: ["react", "react/jsx-runtime"],
    loader: { ".css": "empty" },
  });
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, {
    module,
    exports: module.exports,
    require,
  });
  return module.exports;
}
const {
  getHistoryDictionaryInitialScrollSpeed: speed,
  intersectHistoryDictionaryInitialBounds: intersect,
  attachHistoryDictionaryInitialDrag: attach,
} = await bundle("../src/lib/historyDictionaryInitialDrag.ts");
const Filter = (
  await bundle("../src/components/common/HistoryDictionaryInitialFilter.tsx")
).default;
const markup = renderToStaticMarkup(
  React.createElement(Filter, { value: "", onChange() {} }),
);
const renderedButtons = [...markup.matchAll(/<button([^>]*)>/g)].map(
  (match) => ({
    initial: match[1].match(/data-history-initial="([^"]*)"/)?.[1],
    character: match[1].includes("data-history-initial-character"),
  }),
);
assert.equal(renderedButtons.length, 53);
assert.equal(renderedButtons.filter((button) => button.character).length, 50);
assert.ok(renderedButtons.every((button) => button.initial !== undefined));
assert.equal(speed(200, 100, 300), 0);
assert.equal(speed(100, 100, 300), -480);
assert.equal(speed(120, 100, 300), -240);
assert.equal(speed(280, 100, 300), 240);
assert.equal(speed(300, 100, 300), 480);
assert.equal(speed(-200, 100, 300), -480);
assert.equal(speed(800, 100, 300), 480);
assert.equal(speed(100, 100, 100), 0);
assert.equal(speed(115, 100, 130), 0);
const clipped = intersect(
  { top: 232, bottom: 936, left: 10, right: 74 },
  { top: 0, bottom: 800, left: 0, right: 1280 },
);
assert.equal(clipped.bottom, 800);
assert.equal(clipped.top, 232);
assert.equal(
  intersect(clipped, { top: 300, bottom: 600, left: 30, right: 60 }, false)
    .left,
  10,
);
assert.equal(
  intersect(
    clipped,
    { top: 300, bottom: 600, left: 30, right: 60 },
    true,
    false,
  ).top,
  232,
);

// Real EventTarget dispatch exercises the production listeners. Only geometry,
// capture and animation frames are modeled; browser layout is checked separately.
function fixture({
  railTop = 80,
  railHeight = 240,
  viewportHeight = 800,
  clips = [],
} = {}) {
  let disabled = false;
  let numbersOpen = false;
  let lettersOpen = false;
  let sequence = 0;
  let clock = 0;
  let focused = null;
  let captures = new Set();
  const selected = [];
  const frames = new Map();
  const view = new EventTarget();
  view.innerWidth = 1280;
  view.innerHeight = viewportHeight;
  view.visualViewport = new EventTarget();
  view.visualViewport.offsetLeft = 0;
  view.visualViewport.offsetTop = 0;
  Object.defineProperty(view.visualViewport, "width", {
    get: () => view.innerWidth,
  });
  Object.defineProperty(view.visualViewport, "height", {
    get: () => view.innerHeight,
  });
  let styleReads = 0;
  view.getComputedStyle = (node) => {
    styleReads++;
    return node.style;
  };
  let resizeObserver;
  view.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.observed = new Set();
      resizeObserver = this;
    }
    observe(node) {
      this.observed.add(node);
    }
    disconnect() {
      this.observed.clear();
      this.disconnected = true;
    }
  };
  view.requestAnimationFrame = (callback) => {
    const id = ++sequence;
    frames.set(id, callback);
    return id;
  };
  view.cancelAnimationFrame = (id) => frames.delete(id);
  const rail = new EventTarget();
  const styleProperties = new Map();
  let styleWrites = 0;
  rail.style = {
    getPropertyValue(name) {
      return styleProperties.get(name) ?? "";
    },
    getPropertyPriority() {
      return "";
    },
    setProperty(name, value) {
      styleWrites++;
      styleProperties.set(name, value);
    },
    removeProperty(name) {
      styleProperties.delete(name);
    },
  };
  rail.scrollTop = 0;
  Object.defineProperty(rail, "clientHeight", {
    get: () =>
      Math.min(
        railHeight,
        parseFloat(
          rail.style.getPropertyValue(
            "--history-dictionary-rail-visible-height",
          ),
        ) || Infinity,
      ),
  });
  rail.captureFails = false;
  rail.getBoundingClientRect = () => ({
    left: 10,
    right: 74,
    top: railTop,
    bottom: railTop + rail.clientHeight,
  });
  const ancestors = clips.map(
    ({ top, bottom, overflowX = "visible", overflowY = "auto" }) => ({
      style: { overflowX, overflowY },
      bounds: { top, bottom, left: 0, right: 1280 },
      getBoundingClientRect() {
        return this.bounds;
      },
    }),
  );
  ancestors.forEach((node, index) => {
    node.parentElement = ancestors[index + 1] ?? null;
  });
  rail.parentElement = ancestors[0] ?? null;
  rail.setPointerCapture = (id) => {
    if (rail.captureFails) throw new Error("Pointer is no longer active");
    captures.add(id);
  };
  rail.hasPointerCapture = (id) => captures.has(id);
  rail.releasePointerCapture = (id) => captures.delete(id);
  const buttons = renderedButtons.map(({ initial, character }) => ({
    initial,
    character,
    disabled: false,
    closest(selector) {
      return selector.includes("-character]") && !character ? null : this;
    },
    getAttribute(name) {
      return name === "data-history-initial" ? initial : null;
    },
    focus(options) {
      assert.equal(options.preventScroll, true);
      focused = initial;
    },
  }));
  rail.contains = (button) => buttons.includes(button);
  const visible = () =>
    buttons.filter(
      ({ initial }) =>
        (!/^[0-9]$/.test(initial) && !/^[a-z]$/.test(initial)) ||
        (/^[0-9]$/.test(initial) && numbersOpen) ||
        (/^[a-z]$/.test(initial) && lettersOpen),
    );
  Object.defineProperty(rail, "scrollHeight", {
    get: () => visible().length * 48 + 8,
  });
  const button = (initial) => buttons.find((item) => item.initial === initial);
  const center = (initial) =>
    railTop + 4 + visible().indexOf(button(initial)) * 48 + 22 - rail.scrollTop;
  const doc = new EventTarget();
  doc.defaultView = view;
  doc.elementFromPoint = (x, y) => {
    if (
      x < 14 ||
      x > 70 ||
      y < railTop + 4 ||
      y > railTop + rail.clientHeight - 4 ||
      y < 0 ||
      y > view.innerHeight
    )
      return null;
    if (
      ancestors.some(
        (node) =>
          /auto|scroll|hidden|clip/.test(node.style.overflowY) &&
          (y < node.bounds.top || y > node.bounds.bottom),
      )
    )
      return null;
    const offset = y - railTop - 4 + rail.scrollTop;
    return offset % 48 < 44 ? visible()[Math.floor(offset / 48)] || null : null;
  };
  rail.ownerDocument = doc;
  const controller = attach(rail, {
    isDisabled: () => disabled,
    onSelect(initial) {
      selected.push(initial);
      if (initial === "0-9") numbersOpen = true;
      if (initial === "a-z") lettersOpen = true;
    },
  });
  function dispatch(type, values = {}) {
    const event = new Event(type, { cancelable: true, bubbles: true });
    const props = {
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: 40,
      clientY: center("ㄱ"),
      detail: 1,
      ...values,
    };
    Object.defineProperty(event, "target", {
      value: props.target ?? button("ㄱ"),
    });
    delete props.target;
    Object.assign(event, props);
    rail.dispatchEvent(event);
    return event;
  }
  return {
    rail,
    doc,
    view,
    controller,
    buttons,
    button,
    center,
    selected,
    frames,
    captures,
    dispatch,
    ancestors,
    resizeObserver,
    get styleWrites() {
      return styleWrites;
    },
    setRailTop(top) {
      railTop = top;
    },
    get styleReads() {
      return styleReads;
    },
    get focused() {
      return focused;
    },
    setDisabled(value) {
      disabled = value;
    },
    nextFrame() {
      const callbacks = [...frames.values()];
      frames.clear();
      clock += 16;
      callbacks.forEach((callback) => callback(clock));
    },
  };
}

{
  const f = fixture({ railTop: 232, railHeight: 704, viewportHeight: 800 });
  f.dispatch("pointerdown");
  f.dispatch("pointermove", { clientY: 799 });
  const count = f.selected.length;
  for (let index = 0; index < 10; index++) f.nextFrame();
  assert.ok(
    f.rail.scrollTop > 0,
    "The visible viewport bottom starts edge scrolling before the rail bottom",
  );
  assert.ok(
    f.selected.length > count,
    "Hit testing remains inside the visible viewport during scrolling",
  );
  assert.equal(f.rail.clientHeight, 552);
  for (let index = 0; index < 600; index++) f.nextFrame();
  assert.ok(
    f.selected.includes("z"),
    "The first, partly clipped page can reach the final expanded letter",
  );
  assert.equal(f.rail.scrollTop, f.rail.scrollHeight - f.rail.clientHeight);
  f.controller.dispose();
}

{
  const f = fixture({ railTop: 232, railHeight: 704 });
  assert.equal(f.rail.clientHeight, 552);
  f.setRailTop(272);
  f.dispatch("pointerdown");
  assert.equal(
    f.rail.clientHeight,
    512,
    "Drag start refits after an above-rail filter moves the unchanged grid",
  );
  f.dispatch("pointermove", { clientY: 799 });
  for (let index = 0; index < 600; index++) f.nextFrame();
  assert.ok(
    f.selected.includes("z"),
    "Layout shifts without scroll/resize still allow reaching the last letter",
  );
  f.controller.dispose();
}

{
  const f = fixture({
    railTop: 232,
    railHeight: 704,
    clips: [{ top: 0, bottom: 900 }],
  });
  assert.equal(f.rail.clientHeight, 552);
  assert.equal(
    f.resizeObserver.observed.size,
    1,
    "Each clipping/parent element is observed once",
  );
  const writes = f.styleWrites;
  f.doc.dispatchEvent(new Event("scroll"));
  f.view.dispatchEvent(new Event("resize"));
  f.view.visualViewport.dispatchEvent(new Event("resize"));
  f.view.visualViewport.dispatchEvent(new Event("scroll"));
  f.resizeObserver.callback();
  assert.equal(
    f.frames.size,
    1,
    "Scroll, resize and observer updates share one layout frame",
  );
  f.nextFrame();
  assert.equal(
    f.styleWrites,
    writes,
    "Unchanged dimensions do not rewrite the CSS variable",
  );
  f.setRailTop(80);
  f.doc.dispatchEvent(new Event("scroll"));
  f.nextFrame();
  assert.equal(
    f.rail.clientHeight,
    704,
    "A rail grows again after reaching its sticky top",
  );
  f.ancestors[0].bounds.bottom = 500;
  f.resizeObserver.callback();
  f.nextFrame();
  assert.equal(
    f.rail.clientHeight,
    404,
    "Resized scrollport height constrains the rail",
  );
  f.view.innerHeight = 400;
  f.view.visualViewport.dispatchEvent(new Event("resize"));
  f.nextFrame();
  assert.equal(
    f.rail.clientHeight,
    304,
    "Mobile visible viewport changes constrain the rail",
  );
  f.view.dispatchEvent(new Event("resize"));
  assert.equal(f.frames.size, 1);
  f.controller.dispose();
  assert.equal(f.frames.size, 0, "Unmount cancels pending layout measurement");
  assert.equal(f.resizeObserver.observed.size, 0);
  assert.equal(
    f.rail.style.getPropertyValue("--history-dictionary-rail-visible-height"),
    "",
  );
  f.doc.dispatchEvent(new Event("scroll"));
  f.view.dispatchEvent(new Event("resize"));
  f.view.visualViewport.dispatchEvent(new Event("resize"));
  f.resizeObserver.callback();
  assert.equal(
    f.frames.size,
    0,
    "Unmount removes layout listeners and late observer callbacks do nothing",
  );
}

{
  const f = fixture({
    railTop: 200,
    railHeight: 704,
    clips: [
      { top: 200, bottom: 640, overflowY: "auto" },
      { top: 180, bottom: 600, overflowY: "hidden" },
    ],
  });
  f.dispatch("pointerdown");
  f.dispatch("pointermove", { clientY: 599 });
  for (let index = 0; index < 10; index++) f.nextFrame();
  assert.ok(
    f.rail.scrollTop > 0,
    "Nested dialog/scrollport clipping determines the visible edge",
  );
  assert.equal(f.styleReads, 2, "Overflow styles are read once at attachment");
  const before = f.rail.scrollTop;
  f.ancestors[1].bounds.bottom = 500;
  f.dispatch("pointermove", { clientY: 499 });
  f.nextFrame();
  assert.ok(
    f.rail.scrollTop > before,
    "Ancestor geometry is refreshed after dialog resizing/scrolling",
  );
  assert.equal(f.styleReads, 2);
  f.controller.dispose();
}

{
  const f = fixture({
    railTop: 200,
    railHeight: 704,
    clips: [
      { top: 200, bottom: 300, overflowY: "visible", overflowX: "hidden" },
    ],
  });
  f.dispatch("pointerdown");
  f.dispatch("pointermove", { clientY: 299 });
  f.nextFrame();
  assert.equal(
    f.rail.scrollTop,
    0,
    "An x-only clipping ancestor must not invent a vertical edge",
  );
  f.view.innerHeight = 450;
  f.dispatch("pointermove", { clientY: 449 });
  f.nextFrame();
  assert.ok(
    f.rail.scrollTop > 0,
    "Viewport dimensions are refreshed after resize",
  );
  f.controller.dispose();
}

{
  const f = fixture();
  let nativeClicks = 0;
  f.rail.addEventListener("click", () => nativeClicks++);
  assert.equal(f.dispatch("pointerdown").defaultPrevented, true);
  assert.equal(f.focused, "ㄱ");
  assert.ok(f.captures.has(7));
  assert.deepEqual(f.selected, ["ㄱ"]);
  f.dispatch("pointermove", { clientY: f.center("ㄴ") });
  f.dispatch("pointermove", { clientY: f.center("ㄴ") });
  f.dispatch("pointermove", { pointerId: 8, clientY: f.center("ㄷ") });
  f.dispatch("pointermove", { clientX: 100, clientY: f.center("ㄷ") });
  assert.deepEqual(f.selected, ["ㄱ", "ㄴ"]);
  f.dispatch("pointerup");
  assert.equal(f.captures.size, 0);
  assert.equal(f.frames.size, 0);
  assert.equal(f.dispatch("click").defaultPrevented, true);
  assert.equal(
    nativeClicks,
    0,
    "Drag must not also run the React click action",
  );
  assert.equal(f.dispatch("click", { detail: 0 }).defaultPrevented, false);
  assert.equal(nativeClicks, 1, "Keyboard/assistive activation remains native");
  f.controller.dispose();
}

{
  const f = fixture();
  for (const initial of ["", "0-9", "a-z"]) {
    assert.equal(
      f.dispatch("pointerdown", { target: f.button(initial) }).defaultPrevented,
      false,
    );
    assert.equal(
      f.dispatch("click", { target: f.button(initial) }).defaultPrevented,
      false,
    );
  }
  assert.deepEqual(
    f.selected,
    [],
    "All/group native click and keyboard behavior is preserved",
  );
  f.dispatch("pointerdown");
  f.dispatch("pointermove", { clientY: f.center("0-9") });
  assert.deepEqual(f.selected, ["ㄱ", "0-9"]);
  f.dispatch("pointermove", { clientY: f.center("0-9") });
  assert.equal(
    f.selected.length,
    2,
    "Holding a group must not repeatedly toggle it closed",
  );
  f.dispatch("pointermove", { clientY: f.center("0") });
  assert.equal(
    f.selected.at(-1),
    "0",
    "Expanded characters can be selected in the same drag",
  );
  f.dispatch("pointerup");
  f.dispatch("pointerdown", { target: f.button("0"), clientY: f.center("0") });
  assert.equal(
    f.selected.at(-1),
    "0",
    "Number characters can start a new drag",
  );
  f.controller.dispose();
}

{
  const f = fixture();
  f.dispatch("pointerdown");
  f.dispatch("pointermove", { clientY: 319 });
  for (let index = 0; index < 600; index++) f.nextFrame();
  assert.equal(f.rail.scrollTop, f.rail.scrollHeight - f.rail.clientHeight);
  assert.ok(
    f.selected.includes("a-z"),
    "Drag automatically opens the Latin group at the bottom",
  );
  assert.ok(
    f.selected.includes("z"),
    "Edge scrolling reaches the last expanded character",
  );
  const downTop = f.rail.scrollTop;
  f.dispatch("pointermove", { clientX: 100, clientY: 80 });
  f.nextFrame();
  assert.equal(
    f.rail.scrollTop,
    downTop,
    "Leaving the rail horizontally stops edge scrolling",
  );
  f.dispatch("pointermove", { clientX: 40, clientY: 80 });
  for (let index = 0; index < 600; index++) f.nextFrame();
  assert.equal(f.rail.scrollTop, 0);
  assert.ok(f.selected.includes(""), "Dragging upward can reach All");
  f.controller.dispose();
  assert.equal(f.frames.size, 0);
}

for (const end of [
  "pointerup",
  "pointercancel",
  "lostpointercapture",
  "blur",
  "disabled",
  "dispose",
  "released-mouse",
]) {
  const f = fixture();
  f.dispatch("pointerdown");
  f.dispatch("pointermove", { clientY: 319 });
  f.nextFrame();
  const top = f.rail.scrollTop;
  const selectionCount = f.selected.length;
  if (end === "blur") f.view.dispatchEvent(new Event("blur"));
  else if (end === "disabled") {
    f.setDisabled(true);
    f.nextFrame();
  } else if (end === "dispose") f.controller.dispose();
  else if (end === "released-mouse")
    f.dispatch("pointermove", { pointerType: "mouse", buttons: 0 });
  else f.dispatch(end);
  f.nextFrame();
  f.dispatch("pointermove", { clientY: f.center("ㄴ") });
  assert.equal(f.captures.size, 0, `${end} releases capture`);
  assert.equal(f.frames.size, 0, `${end} cancels all animation work`);
  assert.equal(f.rail.scrollTop, top, `${end} stops scrolling`);
  assert.equal(f.selected.length, selectionCount, `${end} stops selection`);
  f.controller.dispose();
}

for (const ignored of [
  "disabled",
  "button-disabled",
  "secondary",
  "right-click",
  "capture-failure",
]) {
  const f = fixture();
  if (ignored === "disabled") f.setDisabled(true);
  if (ignored === "button-disabled") f.button("ㄱ").disabled = true;
  if (ignored === "capture-failure") f.rail.captureFails = true;
  const overrides =
    ignored === "secondary"
      ? { isPrimary: false }
      : ignored === "right-click"
        ? { button: 2 }
        : {};
  assert.equal(f.dispatch("pointerdown", overrides).defaultPrevented, false);
  assert.deepEqual(f.selected, []);
  assert.equal(f.frames.size, 0);
  assert.equal(f.dispatch("click").defaultPrevented, false);
  f.controller.dispose();
}

{
  const f = fixture();
  f.dispatch("pointerdown");
  f.controller.dispose();
  const count = f.selected.length;
  f.dispatch("pointerdown");
  assert.equal(f.selected.length, count, "Unmount removes pointer listeners");
  assert.equal(
    f.dispatch("click").defaultPrevented,
    false,
    "Unmount removes click suppression listener",
  );
}
console.log(
  "PASS initial rail rendered targets, pointer capture, continuous selection, native/keyboard clicks, group expansion, edge scrolling, cancellation, disabled state, and teardown",
);
