import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// The settings provider keeps its previous object only when this comparison
// says "same". A wrong "same" would hide a server change, so every doubtful
// case below must report a difference.
const code = ts.transpileModule(
  fs.readFileSync(
    new URL("../src/lib/settingsEquality.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const exports = {};
vm.runInNewContext(code, { exports, Object, Array });
const { isSameSettingValue, keepSameSetting } = exports;

class Stamp {
  constructor(seconds) {
    this.seconds = seconds;
  }
  isEqual(other) {
    return other instanceof Stamp && other.seconds === this.seconds;
  }
}
class Opaque {
  constructor(value) {
    this.value = value;
  }
}

const menu = () => ({
  orderVersion: 1,
  student: [
    {
      name: "학습",
      url: "/student/lesson/note",
      children: [
        { name: "수업 자료", url: "/student/lesson/note" },
        { name: "역사 지도", url: "/student/lesson/maps", hidden: true },
      ],
    },
  ],
  teacher: [],
});
const config = () => ({
  year: "2026",
  semester: "2",
  showQuiz: true,
  showScore: true,
  showLesson: true,
  studentMenuVisibility: { weplay: true, avatar: false },
});

let checks = 0;
const same = (left, right, message) => {
  assert.equal(isSameSettingValue(left, right), true, message);
  assert.equal(isSameSettingValue(right, left), true, `${message} (reversed)`);
  checks += 2;
};
const different = (left, right, message) => {
  assert.equal(isSameSettingValue(left, right), false, message);
  assert.equal(isSameSettingValue(right, left), false, `${message} (reversed)`);
  checks += 2;
};

same(config(), config(), "equal system settings");
same(menu(), menu(), "equal menu settings");
same(
  { a: 1, b: { c: [1, 2] } },
  { b: { c: [1, 2] }, a: 1 },
  "key order does not matter",
);
same(null, null, "null equals null");
same({}, {}, "empty settings");
same({ at: new Stamp(10) }, { at: new Stamp(10) }, "value classes use isEqual");
same(Object.create(null), {}, "prototype-less empty map equals empty object");

different(config(), { ...config(), showLesson: false }, "system switch closed");
different(
  config(),
  { ...config(), studentMenuVisibility: { weplay: true, avatar: true } },
  "server projection changed",
);
different(
  config(),
  { ...config(), studentMenuVisibility: undefined },
  "projection removed",
);
{
  const hidden = menu();
  hidden.student[0].children[0].hidden = true;
  different(menu(), hidden, "one child hidden");
  const parentHidden = menu();
  parentHidden.student[0].hidden = true;
  different(menu(), parentHidden, "parent hidden");
  const reordered = menu();
  reordered.student[0].children.reverse();
  different(menu(), reordered, "array order is content");
  const shorter = menu();
  shorter.student[0].children.pop();
  different(menu(), shorter, "child removed");
}
different({ a: 1 }, { a: 1, b: undefined }, "extra key, even when undefined");
different({ a: undefined }, { b: undefined }, "different undefined keys");
different({ a: null }, { a: undefined }, "null is not undefined");
different({ a: 0 }, { a: false }, "0 is not false");
different({ a: "1" }, { a: 1 }, "string is not number");
different({ a: [] }, { a: {} }, "array is not object");
different([1, 2], { 0: 1, 1: 2, length: 2 }, "array is not array-like");
different(null, {}, "null is not an object");
different(null, undefined, "null is not undefined at the root");
different({ at: new Stamp(10) }, { at: new Stamp(11) }, "value class differs");
different(
  { at: new Stamp(10) },
  { at: { seconds: 10 } },
  "value class is not its plain copy",
);
different(
  { ref: new Opaque(1) },
  { ref: new Opaque(1) },
  "unknown object kinds are never assumed equal",
);
different({ a: 0 }, { a: -0 }, "signed zero stays conservative");
same({ a: NaN }, { a: NaN }, "NaN equals NaN");

{
  const previous = config();
  const equal = config();
  const changed = { ...config(), showQuiz: false };
  assert.equal(
    keepSameSetting(previous, equal),
    previous,
    "keeps old identity",
  );
  assert.equal(keepSameSetting(previous, changed), changed, "adopts new value");
  assert.equal(keepSameSetting(null, equal), equal, "first value is adopted");
  assert.equal(keepSameSetting(previous, null), null, "failure clears value");
  checks += 4;
}

console.log(
  `Settings equality passed (${checks} assertions; local VM, no Firebase/network).`,
);
