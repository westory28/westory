import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import ts from "typescript";

// Exercise the component's handlers with persistent React hook slots. Native
// number parsing/spinner behavior also requires a real-browser smoke test.
let active;
const react = {
  ...React,
  useState(initial) {
    const fixture = active;
    const slot = fixture.cursor++;
    if (!(slot in fixture.slots)) fixture.slots[slot] = initial;
    return [
      fixture.slots[slot],
      (next) => {
        if (!Object.is(fixture.slots[slot], next)) fixture.dirty = true;
        fixture.slots[slot] = next;
      },
    ];
  },
  useRef(initial) {
    const slot = active.cursor++;
    active.slots[slot] ??= { current: initial };
    return active.slots[slot];
  },
  useLayoutEffect(effect) {
    active.effects.push(effect);
  },
};
const exports = {};
vm.runInNewContext(
  ts.transpileModule(
    readFileSync("src/components/common/NumericInput.tsx", "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    },
  ).outputText,
  {
    exports,
    require: (id) => {
      assert.equal(id, "react");
      return react;
    },
  },
);
const Component = exports.default;

function fixture(value = 90, extra = {}, convert = Number) {
  const f = {
    slots: [],
    cursor: 0,
    effects: [],
    dirty: false,
    model: value,
    calls: [],
    ref: { current: null },
    input: { value: String(value), validity: { badInput: false } },
  };
  f.props = {
    value,
    ...extra,
    onChange(event) {
      assert.equal(
        event.currentTarget,
        f.input,
        "Forward the original native target",
      );
      f.calls.push(event.currentTarget.value);
      f.model = convert(event.currentTarget.value);
      f.props.value = f.model;
    },
  };
  f.render = () => {
    let remaining = 5;
    do {
      active = f;
      f.cursor = 0;
      f.dirty = false;
      f.node = Component.render(f.props, f.ref);
      f.effects.splice(0).forEach((effect) => effect());
      assert.ok(remaining-- > 0, "Effects must settle");
    } while (f.dirty);
    if (f.node.props.value != null) f.input.value = String(f.node.props.value);
  };
  f.event = () => ({ currentTarget: f.input, target: f.input });
  f.focus = () => {
    f.node.props.onFocus(f.event());
    f.render();
  };
  f.change = (next, badInput = false) => {
    f.input.value = next;
    f.input.validity.badInput = badInput;
    f.node.props.onChange(f.event());
    f.render();
  };
  f.blur = () => {
    f.node.props.onBlur(f.event());
    f.render();
  };
  f.render();
  return f;
}

const number = fixture();
number.focus();
number.change("");
assert.equal(number.input.value, "");
assert.equal(number.model, 90, "Clearing must not write a synthetic zero");
assert.equal(number.calls.length, 0);
number.change("9");
number.change("90");
assert.equal(number.model, 90);
assert.equal(number.input.value, "90");
number.change("0");
assert.equal(number.model, 0, "Zero is a real input, not a fallback");
number.blur();
assert.equal(number.input.value, "0");
number.focus();
number.change("");
number.blur();
assert.equal(
  number.input.value,
  "0",
  "An abandoned blank restores the valid value",
);

const clamped = fixture(5, { min: 5, max: 100, step: 1 }, (raw) =>
  Math.max(5, Math.min(100, Number(raw))),
);
clamped.focus();
clamped.change("");
clamped.change("1");
assert.equal(clamped.model, 5);
assert.equal(
  clamped.input.value,
  "1",
  "Parent minimum must not replace the first digit",
);
clamped.change("10");
assert.equal(clamped.model, 10);
clamped.change("1000");
assert.equal(clamped.input.value, "1000");
assert.equal(clamped.model, 100);
clamped.blur();
assert.equal(
  clamped.input.value,
  "100",
  "Blur shows existing parent validation",
);
assert.equal(clamped.node.props.min, 5);
assert.equal(clamped.node.props.max, 100);
assert.equal(clamped.node.props.step, 1);
assert.equal(clamped.node.props.type, "number");
assert.equal(
  clamped.node.ref,
  clamped.ref,
  "Forward the ref directly to the native input",
);

const decimal = fixture(2, { step: "any" });
decimal.focus();
decimal.change("", true);
assert.equal(
  decimal.model,
  2,
  "Incomplete minus/exponent does not erase the number",
);
decimal.change("-0.5");
assert.equal(decimal.model, -0.5);
decimal.change("1e2");
assert.equal(decimal.model, 100);
assert.equal(decimal.input.value, "1e2");
decimal.blur();
assert.equal(decimal.input.value, "100");

const optional = fixture("12", { allowEmpty: true }, String);
optional.focus();
optional.change("", true);
assert.equal(optional.model, "12", "badInput is not an optional empty field");
optional.change("");
assert.equal(optional.model, "");
optional.blur();
assert.equal(optional.input.value, "");
optional.focus();
optional.change("0");
assert.equal(optional.model, "0");

const reset = fixture();
reset.focus();
reset.change("");
reset.props.value = 35;
reset.render();
assert.equal(
  reset.input.value,
  "35",
  "An external value update replaces a stale draft",
);
reset.change("");
reset.props.disabled = true;
reset.render();
assert.equal(reset.input.value, "35");
reset.props.disabled = false;
reset.focus();
reset.change("");
reset.props.readOnly = true;
reset.render();
assert.equal(reset.input.value, "35");

const events = [];
const callbacks = fixture(10, {
  id: "score",
  name: "score",
  required: true,
  "aria-label": "점수",
  onFocus: (event) => events.push(["focus", event.currentTarget]),
  onBlur: (event) => events.push(["blur", event.currentTarget]),
  onKeyDown: () => events.push(["enter"]),
});
callbacks.focus();
callbacks.change("25");
callbacks.node.props.onKeyDown({ key: "Enter" });
assert.equal(
  callbacks.model,
  25,
  "Enter/save already sees the latest valid numeric model",
);
callbacks.blur();
assert.deepEqual(events, [
  ["focus", callbacks.input],
  ["enter"],
  ["blur", callbacks.input],
]);
assert.equal(callbacks.node.props.required, true);
assert.equal(callbacks.node.props["aria-label"], "점수");
assert.equal(
  callbacks.node.props.allowEmpty,
  undefined,
  "Internal options must not leak into DOM attributes",
);

console.log(
  "Numeric input regression checks passed: clear/retype, zero, clamps, decimals, negatives, optional blank, external reset, callbacks and native attributes.",
);
