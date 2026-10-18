import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const result = await build({
  entryPoints: [
    fileURLToPath(
      new URL("../src/lib/historyDictionaryInitialDrag.ts", import.meta.url),
    ),
  ],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
});
const module = { exports: {} };
vm.runInNewContext(result.outputFiles[0].text, {
  module,
  exports: module.exports,
  require,
});
const {
  getHistoryDictionaryInitialItems: itemsFor,
  getHistoryDictionaryInitialWindow: windowFor,
  getHistoryDictionaryInitialDragSteps: stepsFor,
  attachHistoryDictionaryInitialDrag: attach,
  intersectHistoryDictionaryInitialBounds: intersect,
} = module.exports;

for (const [numbers, letters] of [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
]) {
  const items = itemsFor(numbers, letters);
  assert.equal(items.length, 17 + (numbers ? 10 : 0) + (letters ? 26 : 0));
  for (let capacity = 1; capacity <= 54; capacity++)
    for (const value of items) {
      const rows = windowFor(items, value, capacity);
      assert.ok(rows.length <= capacity, `${capacity} slots / ${value}`);
      assert.equal(
        rows.filter((row) => row.type === "initial" && row.value === value)
          .length,
        1,
        `Selection must remain visible: ${capacity}/${value}`,
      );
      assert.equal(
        new Set(
          rows.filter((row) => row.type === "initial").map((row) => row.value),
        ).size,
        rows.filter((row) => row.type === "initial").length,
      );
      if (capacity >= 4)
        for (const anchor of ["", "0-9", "a-z"])
          assert.ok(
            rows.some((row) => row.type === "initial" && row.value === anchor),
          );
      for (const row of rows)
        if (row.type === "more") assert.ok(items.includes(row.target));
    }
}
const middle = windowFor(itemsFor(false, false), "ㅁ", 8);
assert.equal(middle[0].value, "");
assert.equal(middle[1].value, "0-9");
assert.equal(middle.at(-1).value, "a-z");
assert.equal(middle.filter((row) => row.type === "more").length, 2);
assert.equal(stepsFor(43), 0);
assert.equal(stepsFor(44), 1);
assert.equal(stepsFor(131), 2);
assert.equal(stepsFor(-44), -1);
assert.equal(
  intersect(
    { top: 232, bottom: 936, left: 10, right: 74 },
    { top: 0, bottom: 800, left: 0, right: 1280 },
  ).bottom,
  800,
);

function fixture({
  initial = "ㄱ",
  numbers = false,
  letters = false,
  top = 80,
  maxHeight = 320,
  viewportHeight = 800,
  clips = [],
} = {}) {
  let value = initial;
  let disabled = false;
  let capacity = 1;
  let clock = 0;
  let sequence = 0;
  let styleWrites = 0;
  let captureFails = false;
  let resizeObserver;
  const items = itemsFor(numbers, letters);
  const selected = [];
  const frames = new Map();
  const captures = new Set();
  const styles = new Map();
  const view = new EventTarget();
  view.innerWidth = 1280;
  view.innerHeight = viewportHeight;
  view.visualViewport = new EventTarget();
  Object.assign(view.visualViewport, { offsetTop: 0, offsetLeft: 0 });
  Object.defineProperty(view.visualViewport, "width", {
    get: () => view.innerWidth,
  });
  Object.defineProperty(view.visualViewport, "height", {
    get: () => view.innerHeight,
  });
  view.getComputedStyle = (node) => node.style;
  view.requestAnimationFrame = (callback) => {
    const id = ++sequence;
    frames.set(id, callback);
    return id;
  };
  view.cancelAnimationFrame = (id) => frames.delete(id);
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
    }
  };
  const rail = new EventTarget();
  rail.style = {
    getPropertyValue: (name) => styles.get(name) ?? "",
    getPropertyPriority: () => "",
    setProperty: (name, value) => {
      styleWrites++;
      styles.set(name, value);
    },
    removeProperty: (name) => styles.delete(name),
  };
  Object.defineProperty(rail, "clientHeight", {
    get: () =>
      Math.min(
        maxHeight,
        items.length * 44 + 10,
        parseFloat(styles.get("--history-dictionary-rail-visible-height")) ||
          Infinity,
      ) - 2,
  });
  Object.defineProperty(rail, "scrollTop", {
    get: () => 0,
    set() {
      assert.fail("The rail must never internally scroll");
    },
  });
  rail.getBoundingClientRect = () => ({
    top,
    bottom: top + rail.clientHeight + 2,
    left: 10,
    right: 74,
  });
  rail.setPointerCapture = (id) => {
    if (captureFails) throw new Error("inactive");
    captures.add(id);
  };
  rail.hasPointerCapture = (id) => captures.has(id);
  rail.releasePointerCapture = (id) => captures.delete(id);
  const ancestors = clips.map(
    ({
      clipTop = 0,
      bottom = 800,
      overflowY = "auto",
      overflowX = "visible",
    }) => ({
      style: { overflowX, overflowY },
      bounds: { top: clipTop, bottom, left: 0, right: 1280 },
      getBoundingClientRect() {
        return this.bounds;
      },
    }),
  );
  ancestors.forEach((node, index) => {
    node.parentElement = ancestors[index + 1] ?? null;
  });
  rail.parentElement = ancestors[0] ?? null;
  const buttons = items.map((initial) => ({
    initial,
    disabled: false,
    closest(selector) {
      return selector.includes("-character]") &&
        (!initial || initial === "0-9" || initial === "a-z")
        ? null
        : this;
    },
    getAttribute: (name) => (name === "data-history-initial" ? initial : null),
    hasAttribute: (name) =>
      name === "data-history-initial-character" &&
      Boolean(initial) &&
      initial !== "0-9" &&
      initial !== "a-z",
    focus() {},
  }));
  rail.contains = (node) => node === rail || buttons.includes(node);
  const button = (initial) => buttons.find((item) => item.initial === initial);
  const more = {
    disabled: false,
    target: "ㅇ",
    closest() {
      return this;
    },
    hasAttribute() {
      return false;
    },
    getAttribute(name) {
      return name === "data-history-initial-more-target" ? this.target : null;
    },
  };
  buttons.push(more);
  const doc = new EventTarget();
  doc.defaultView = view;
  doc.elementFromPoint = () => {
    assert.fail("Window replacement must not hit-test a stationary pointer");
  };
  rail.ownerDocument = doc;
  const controller = attach(rail, {
    isDisabled: () => disabled,
    getItems: () => items,
    getValue: () => value,
    onSelect(initial, focus) {
      value = initial;
      selected.push({ value, focus });
    },
    onCapacityChange(next) {
      capacity = next;
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
      clientY: 200,
      detail: 1,
      deltaMode: 0,
      deltaX: 0,
      deltaY: 0,
      ...values,
    };
    Object.defineProperty(event, "target", {
      value: props.target ?? button("ㄱ"),
    });
    Object.defineProperty(event, "timeStamp", {
      value: props.timeStamp ?? clock,
    });
    delete props.target;
    delete props.timeStamp;
    Object.assign(event, props);
    rail.dispatchEvent(event);
    return event;
  }
  return {
    rail,
    view,
    doc,
    controller,
    items,
    button,
    more,
    selected,
    frames,
    captures,
    ancestors,
    resizeObserver,
    dispatch,
    get value() {
      return value;
    },
    get capacity() {
      return capacity;
    },
    get styleWrites() {
      return styleWrites;
    },
    get rows() {
      return windowFor(items, value, capacity);
    },
    setTop(next) {
      top = next;
    },
    setDisabled(next) {
      disabled = next;
    },
    failCapture() {
      captureFails = true;
    },
    nextFrame(duration = 16) {
      const callbacks = [...frames.values()];
      frames.clear();
      clock += duration;
      callbacks.forEach((callback) => callback(clock));
    },
  };
}
{
  const f = fixture();
  let nativeClicks = 0;
  f.rail.addEventListener("click", () => nativeClicks++);
  assert.equal(f.dispatch("pointerdown").defaultPrevented, true);
  assert.ok(f.captures.has(7));
  f.dispatch("pointermove", { clientY: 243 });
  assert.equal(f.value, "ㄱ");
  f.dispatch("pointermove", { clientY: 244 });
  assert.equal(f.value, "ㄴ");
  const selected = f.selected.length;
  for (let index = 0; index < 80; index++) f.nextFrame();
  assert.equal(
    f.selected.length,
    selected,
    "Replacing the visible window cannot re-select at a stationary middle coordinate",
  );
  f.dispatch("pointermove", { clientY: 288 });
  assert.equal(f.value, "ㄷ");
  f.dispatch("pointermove", { clientY: 244 });
  assert.equal(f.value, "ㄴ");
  f.dispatch("pointermove", { pointerId: 8, clientY: 288 });
  assert.equal(f.value, "ㄴ");
  f.dispatch("pointermove", { clientX: 100, clientY: 288 });
  assert.equal(f.value, "ㄴ");
  f.dispatch("pointerup");
  assert.equal(f.frames.size, 0);
  assert.equal(f.captures.size, 0);
  assert.equal(f.dispatch("click").defaultPrevented, true);
  assert.equal(nativeClicks, 0);
  assert.equal(f.dispatch("click", { detail: 0 }).defaultPrevented, false);
  assert.equal(nativeClicks, 1);
  f.controller.dispose();
}
{
  const f = fixture({ numbers: true, letters: true });
  f.dispatch("pointerdown");
  f.dispatch("pointermove", { clientY: 399 });
  for (let index = 0; index < 1000; index++) f.nextFrame();
  assert.equal(
    f.value,
    "z",
    "Holding at the lower edge reaches the final expanded letter",
  );
  assert.ok(f.rows.some((row) => row.type === "initial" && row.value === "z"));
  assert.ok(f.rows.length <= f.capacity);
  f.dispatch("pointermove", { clientY: 80 });
  for (let index = 0; index < 1000; index++) f.nextFrame();
  assert.equal(f.value, "", "Holding the upper edge reaches All");
  f.controller.dispose();
}
{
  const f = fixture();
  for (const initial of ["", "0-9", "a-z"]) {
    assert.equal(
      f.dispatch("pointerdown", { target: f.button(initial) }).defaultPrevented,
      false,
    );
    f.dispatch("pointerup", { target: f.button(initial) });
    assert.equal(
      f.dispatch("click", { target: f.button(initial) }).defaultPrevented,
      false,
    );
  }
  f.dispatch("pointerdown");
  f.dispatch("pointermove", { clientY: 156 });
  assert.equal(f.value, "0-9");
  assert.equal(
    f.items.length,
    17,
    "Dragging into a group selects it without toggling disclosure",
  );
  f.controller.dispose();
}
{
  const f = fixture();
  for (let index = 0; index < 4; index++)
    f.dispatch("wheel", { deltaY: 12, timeStamp: index * 20 });
  assert.equal(f.value, "ㄴ");
  f.dispatch("wheel", { deltaY: 200, timeStamp: 100 });
  assert.equal(
    f.value,
    "ㄴ",
    "Wheel events inside 120ms do not skip another character",
  );
  f.dispatch("wheel", { deltaY: 48, timeStamp: 400 });
  assert.equal(f.value, "ㄷ");
  f.dispatch("wheel", { deltaY: -48, timeStamp: 420 });
  assert.equal(f.value, "ㄴ");
  assert.equal(
    f.dispatch("wheel", { deltaY: 48, ctrlKey: true }).defaultPrevented,
    false,
  );
  assert.equal(
    f.dispatch("wheel", { deltaY: 4, deltaX: 100 }).defaultPrevented,
    false,
  );
  f.dispatch("wheel", { deltaY: 3, deltaMode: 1, timeStamp: 800 });
  assert.equal(f.value, "ㄷ");
  f.dispatch("wheel", { deltaY: 1, deltaMode: 2, timeStamp: 1100 });
  assert.equal(f.value, "ㄹ");
  f.controller.dispose();
}
{
  const f = fixture({ letters: true });
  f.dispatch("keydown", { key: "ArrowDown", target: f.button("ㄴ") });
  assert.equal(
    f.value,
    "ㄷ",
    "Arrow navigation starts from the focused button",
  );
  assert.equal(f.selected.at(-1).focus, true);
  f.dispatch("keydown", { key: "End" });
  assert.equal(f.value, "z");
  f.dispatch("keydown", { key: "Home" });
  assert.equal(f.value, "");
  assert.equal(f.dispatch("keydown", { key: "Enter" }).defaultPrevented, false);
  assert.equal(
    f.dispatch("keydown", { key: "ArrowDown", ctrlKey: true }).defaultPrevented,
    false,
  );
  f.controller.dispose();
}
for (const ending of [
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
  f.dispatch("pointermove", { clientY: 399 });
  if (ending === "blur") f.view.dispatchEvent(new Event("blur"));
  else if (ending === "disabled") {
    f.setDisabled(true);
    f.nextFrame();
  } else if (ending === "dispose") f.controller.dispose();
  else if (ending === "released-mouse")
    f.dispatch("pointermove", { pointerType: "mouse", buttons: 0 });
  else
    f.dispatch(
      ending,
      ending === "lostpointercapture" ? { target: f.rail } : {},
    );
  const value = f.value;
  for (let index = 0; index < 100; index++) f.nextFrame();
  assert.equal(f.value, value, ending);
  assert.equal(f.frames.size, 0, ending);
  assert.equal(f.captures.size, 0, ending);
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
  if (ignored === "capture-failure") f.failCapture();
  const overrides =
    ignored === "secondary"
      ? { isPrimary: false }
      : ignored === "right-click"
        ? { button: 2 }
        : {};
  assert.equal(f.dispatch("pointerdown", overrides).defaultPrevented, false);
  assert.equal(f.selected.length, 0);
  assert.equal(f.frames.size, 0);
  f.controller.dispose();
}
{
  const f = fixture({ top: 232, maxHeight: 704, clips: [{ bottom: 900 }] });
  assert.equal(f.capacity, 12);
  assert.ok(f.rows.length * 44 + 8 <= f.rail.clientHeight);
  const writes = f.styleWrites;
  f.doc.dispatchEvent(new Event("scroll"));
  f.view.dispatchEvent(new Event("resize"));
  f.view.visualViewport.dispatchEvent(new Event("resize"));
  f.resizeObserver.callback();
  assert.equal(f.frames.size, 1);
  f.nextFrame();
  assert.equal(f.styleWrites, writes);
  f.setTop(80);
  f.doc.dispatchEvent(new Event("scroll"));
  f.nextFrame();
  assert.equal(f.capacity, 15);
  f.setTop(272);
  f.dispatch("pointerdown");
  assert.equal(
    f.capacity,
    11,
    "A position-only shift is remeasured at drag start",
  );
  f.dispatch("pointerup");
  f.ancestors[0].bounds.bottom = 500;
  f.resizeObserver.callback();
  f.nextFrame();
  assert.equal(f.capacity, 4);
  f.view.innerHeight = 400;
  f.view.visualViewport.dispatchEvent(new Event("resize"));
  f.nextFrame();
  assert.equal(f.capacity, 2);
  assert.ok(f.rows.length * 44 + 8 <= f.rail.clientHeight);
  f.view.dispatchEvent(new Event("resize"));
  f.controller.dispose();
  assert.equal(f.frames.size, 0);
  assert.equal(f.resizeObserver.observed.size, 0);
  assert.equal(
    f.rail.style.getPropertyValue("--history-dictionary-rail-visible-height"),
    "",
  );
  f.doc.dispatchEvent(new Event("scroll"));
  f.view.dispatchEvent(new Event("resize"));
  f.resizeObserver.callback();
  assert.equal(f.frames.size, 0);
  f.dispatch("pointerdown");
  assert.equal(f.frames.size, 0);
  assert.equal(f.dispatch("click").defaultPrevented, false);
}
console.log(
  "PASS bounded initial windows/anchors, no internal scrolling, logical drag, wheel gestures, keyboard, edge repeat, clipping/resize, cancellation, and cleanup",
);
{
  const f = fixture();
  for (let index = 0; index < 10; index++)
    f.dispatch("wheel", { deltaY: 100, timeStamp: index * 100 });
  assert.equal(
    f.value,
    "ㅂ",
    "Continuous same-direction wheel input keeps advancing with 120ms throttling",
  );
  assert.equal(f.selected.length, 5);
  f.controller.dispose();
}
for (const maxHeight of [54, 98, 142]) {
  for (const initial of ["", "0-9", "a-z"]) {
    const f = fixture({ initial, maxHeight });
    assert.equal(
      f.dispatch("pointerdown", { target: f.button(initial) }).defaultPrevented,
      false,
    );
    f.dispatch("pointermove", { clientY: initial === "a-z" ? 156 : 244 });
    assert.ok(f.captures.has(7));
    assert.notEqual(
      f.value,
      initial,
      `${maxHeight}px capsule starts touch traversal from ${initial || "All"}`,
    );
    assert.ok(
      f.rows.some((row) => row.type === "initial" && row.value === f.value),
    );
    f.dispatch("pointerup");
    assert.equal(
      f.dispatch("click").defaultPrevented,
      true,
      "Dragging a group must not also toggle it",
    );
    f.controller.dispose();
  }
}
console.log(
  "PASS continuous wheel detents and touch traversal from all/group controls in one-to-three-row capsules",
);
{
  const f = fixture();
  f.dispatch("pointerdown", { target: f.button("0-9") });
  f.dispatch("pointermove", { clientY: 244 });
  f.dispatch("lostpointercapture", { target: f.button("0-9") });
  assert.ok(
    f.captures.has(7),
    "Implicit touch capture transfer must not end the rail gesture",
  );
  f.dispatch("pointermove", { clientY: 288 });
  assert.equal(f.value, "ㄴ");
  f.dispatch("lostpointercapture", { target: f.rail });
  assert.equal(f.captures.size, 0);
  f.controller.dispose();
}
console.log(
  "PASS implicit touch capture transfer and final rail capture cancellation",
);
{
  const f = fixture({ top: 232, maxHeight: 704 });
  let nativeClicks = 0;
  f.rail.addEventListener("click", () => nativeClicks++);
  f.dispatch("pointerdown", { target: f.more });
  f.setTop(192);
  f.doc.dispatchEvent(new Event("scroll"));
  f.nextFrame();
  f.more.target = "ㅌ";
  f.dispatch("pointerup", { target: f.more });
  f.dispatch("click", { target: f.more });
  assert.equal(
    f.value,
    "ㅇ",
    "Ellipsis pointer click keeps the target pressed before capacity changes",
  );
  assert.equal(
    nativeClicks,
    0,
    "The reused React click target must not run a second selection",
  );
  f.more.target = "ㅁ";
  f.dispatch("keydown", { key: " ", target: f.more });
  f.more.target = "ㅂ";
  f.dispatch("click", { detail: 0, target: f.more });
  assert.equal(
    f.value,
    "ㅁ",
    "Space activation keeps its target across focus/resize changes",
  );
  f.dispatch("pointerdown", { target: f.more });
  f.dispatch("pointercancel", { target: f.more });
  assert.equal(
    f.dispatch("click", { target: f.more }).defaultPrevented,
    false,
    "Cancellation discards the pending ellipsis target",
  );
  f.controller.dispose();
}
console.log(
  "PASS ellipsis target stability across pointer/keyboard activation and viewport changes",
);
