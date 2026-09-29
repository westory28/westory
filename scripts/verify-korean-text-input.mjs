import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import ts from "typescript";

const loadTs = (path, dependencies = {}, globals = {}) => {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    require: (id) => {
      assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
      return dependencies[id];
    },
    ...globals,
  });
  return exports;
};

const helper = loadTs("src/lib/koreanText.ts");
const normalize = helper.normalizeKoreanText;
const fixtures = [
  ["", ""],
  ["ㅎㅏㄴㄱㅡㄹ", "한글"],
  ["ㅎㅏㄴㄱㅡㄹ ㅇㅕㅇㅇㅓ", "한글 영어"],
  ["하ㄴ", "한"],
  ["한ㄱㅡㄹ", "한글"],
  ["ㄱㅏㄴㅏ", "가나"],
  ["한ㅏ", "하나"],
  ["ㄱㅗㅏ", "과"],
  ["고ㅏ", "과"],
  ["ㄱㅜㅔ", "궤"],
  ["ㄷㅡㅣ", "듸"],
  ["ㄲㅏㄲ", "깎"],
  ["ㄸㅏㄹㄱㅣ", "딸기"],
  ["ㅇㅣㄹㄱ", "읽"],
  ["읽ㅓ", "일거"],
  ["ㄱㅏㅂㅅㅇㅣ", "값이"],
  ["값ㅣ", "갑시"],
  ["ㅇㅏㄴㅈㅇㅏ", "앉아"],
  ["앉ㅏ", "안자"],
  ["ㄱ ㅏ ㄴ", "ㄱ ㅏ ㄴ"],
  ["ㅎㅏ\nㄴㄱㅡㄹ", "하\nㄴ글"],
  ["ㅋㅋ ㅎㅎ ㅠㅠ ㄱㄴㄷ", "ㅋㅋ ㅎㅎ ㅠㅠ ㄱㄴㄷ"],
  ["하ㅋㅋ 하ㅎㅎ", "하ㅋㅋ 하ㅎㅎ"],
  ["핰ㅋ 핳ㅎ", "하ㅋㅋ 하ㅎㅎ"],
  [
    "한글과 이미 완성된 문장, 읽어 값이 앉아",
    "한글과 이미 완성된 문장, 읽어 값이 앉아",
  ],
  ["English gksrmf ABC abc 123 +-_🙂", "English gksrmf ABC abc 123 +-_🙂"],
  ["e\u0301 ABC ㅎㅏㄴ글(100%)", "e\u0301 ABC 한글(100%)"],
  ["ㅎㅏㄴ-ㄱㅡㄹ/ABC", "한-글/ABC"],
  ["한글".normalize("NFD"), "한글"],
  ["읽어 값이 앉아".normalize("NFD"), "읽어 값이 앉아"],
];
for (const [input, expected] of fixtures) {
  assert.equal(normalize(input), expected, input);
  assert.equal(normalize(expected), expected, `idempotent: ${expected}`);
}
for (let codePoint = 0xac00; codePoint <= 0xd7a3; codePoint += 1) {
  const syllable = String.fromCharCode(codePoint);
  assert.equal(
    normalize(syllable),
    syllable,
    "Keep every completed modern syllable",
  );
  assert.equal(
    normalize(syllable.normalize("NFD")),
    syllable,
    "Compose every modern NFD syllable",
  );
}
// A value normalized after each separate browser input must still compose.
for (const [jamo, expected] of [
  ["ㅎㅏㄴㄱㅡㄹ", "한글"],
  ["ㄱㅏㄴㅏ", "가나"],
  ["ㄷㅏㄹㄱㅣ", "달기"],
  ["ㄱㅜㅓㄴ", "권"],
  ["ㅎㅏㅋㅋ", "하ㅋㅋ"],
  ["ㅎㅏㅎㅎ", "하ㅎㅎ"],
]) {
  let current = "";
  for (const char of jamo) current = normalize(current + char);
  assert.equal(current, expected, `incremental: ${jamo}`);
}
const selected = helper.normalizeKoreanTextSelection("Aㅎㅏㄴ글Z", 1, 5);
assert.equal(selected.value, "A한글Z");
assert.equal(selected.selectionStart, 1);
assert.equal(selected.selectionEnd, 3);
const caret = helper.normalizeKoreanTextSelection("한ㄱㅡㄹ ABC", 4);
assert.equal(caret.value, "한글 ABC");
assert.equal(caret.selectionStart, 2);
assert.equal(caret.selectionEnd, 2);

const refs = [];
const effects = [];
let cursor = 0;
let model = "";
let node;
const input = {
  value: "",
  selectionStart: 0,
  selectionEnd: 0,
  selectionDirection: "none",
  setSelectionRange(start, end, direction) {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  },
};
const KoreanTextInput = loadTs(
  "src/pages/teacher/components/KoreanTextInput.tsx",
  {
    react: {
      ...React,
      useRef(initial) {
        const index = cursor++;
        refs[index] ??= { current: initial };
        return refs[index];
      },
      useLayoutEffect(effect) {
        effects.push(effect);
      },
    },
    "../../../lib/koreanText": helper,
  },
  { document: { activeElement: input } },
).default;
const render = () => {
  cursor = 0;
  node = KoreanTextInput({
    value: model,
    onValueChange: (next) => {
      model = next;
    },
  });
  refs[0].current = input;
  input.value = model;
  effects.splice(0).forEach((effect) => effect());
};
const change = (value, isComposing = false) => {
  input.value = value;
  input.selectionStart = input.selectionEnd = value.length;
  node.props.onChange({ currentTarget: input, nativeEvent: { isComposing } });
};
render();
node.props.onCompositionStart({ currentTarget: input });
change("ㅎㅏㄴ", true);
assert.equal(model, "ㅎㅏㄴ", "Keep the IME's active composition unmodified");
assert.equal(input.value, "ㅎㅏㄴ");
render();
node.props.onBlur({ currentTarget: input });
assert.equal(model, "ㅎㅏㄴ", "Blur must not rewrite an active composition");
node.props.onCompositionEnd({ currentTarget: input });
assert.equal(model, "한");
assert.equal(input.value, "한");
assert.equal(input.selectionStart, 1);
render();
change("한ㄱㅡㄹ");
assert.equal(model, "한글");
assert.equal(input.selectionStart, 2);
render();
change("English 123!");
assert.equal(model, "English 123!");
render();
change("ㅎㅏ", true);
assert.equal(
  model,
  "ㅎㅏ",
  "nativeEvent.isComposing also suppresses normalization",
);
node.props.onBlur({ currentTarget: input });
assert.equal(
  model,
  "ㅎㅏ",
  "Keep active native composition through blur even without compositionstart",
);
node.props.onCompositionEnd({ currentTarget: input });
assert.equal(model, "하");
render();
input.value = "Aㅎㅏㄴ글Z";
input.setSelectionRange(1, 5, "backward");
node.props.onChange({
  currentTarget: input,
  nativeEvent: { isComposing: false },
});
assert.equal(model, "A한글Z");
assert.equal(input.selectionStart, 1);
assert.equal(input.selectionEnd, 3);
assert.equal(input.selectionDirection, "backward");
render();
input.value = "한글".normalize("NFD");
input.selectionStart = input.selectionEnd = input.value.length;
node.props.onBlur({ currentTarget: input });
assert.equal(model, "한글");
render();
node.props.onCompositionStart({ currentTarget: input });
change("ㅎㅏㄴㄱ", true);
assert.equal(model, "ㅎㅏㄴㄱ");
// Some browser/IME combinations omit compositionend. The next explicit
// non-composing input must release the previous composition state.
change("ㅎㅏㄴㄱㅡㄹ", false);
assert.equal(model, "한글", "Recover when compositionend is missing");
assert.equal(input.value, "한글");
assert.equal(input.selectionStart, 2);
render();
change("ㅁㅜㄴㅈㅏㅇ", true);
change("ㅁㅜㄴㅈㅏㅇ ㅌㅏㅁㄱㅜ", false);
assert.equal(
  model,
  "문장 탐구",
  "Recover native composition without either composition event",
);
render();
node.props.onCompositionStart({ currentTarget: input });
input.value = "ㅎㅏㄴ";
node.props.onChange({ currentTarget: input, nativeEvent: {} });
assert.equal(
  model,
  "ㅎㅏㄴ",
  "Missing isComposing must retain an active composition",
);
node.props.onBlur({ currentTarget: input });
assert.equal(
  model,
  "ㅎㅏㄴ",
  "Unknown native composition status must not normalize on blur",
);
node.props.onCompositionEnd({ currentTarget: input });
assert.equal(model, "한");
render();
input.value = "ㅎㅏㄴㄱㅡㄹ";
node.props.onChange({ currentTarget: input, nativeEvent: {} });
assert.equal(
  model,
  "한글",
  "Missing isComposing uses the inactive composition state",
);

// Render one shared component module with separate hook state for each row,
// just as React mounts each newly added evaluation-name input independently.
const fields = [];
const multiDocument = { activeElement: null };
let renderingField;
const MultiKoreanTextInput = loadTs(
  "src/pages/teacher/components/KoreanTextInput.tsx",
  {
    react: {
      ...React,
      useRef(initial) {
        const index = renderingField.cursor++;
        renderingField.refs[index] ??= { current: initial };
        return renderingField.refs[index];
      },
      useLayoutEffect(effect) {
        renderingField.effects.push(effect);
      },
    },
    "../../../lib/koreanText": helper,
  },
  { document: multiDocument },
).default;
const renderField = (field) => {
  renderingField = field;
  field.cursor = 0;
  field.node = MultiKoreanTextInput({
    value: field.value,
    onValueChange: (next) => {
      field.value = next;
    },
  });
  field.refs[0].current = field.input;
  field.input.value = field.value;
  field.effects.splice(0).forEach((effect) => effect());
};
const addField = () => {
  const field = {
    value: "",
    refs: [],
    effects: [],
    cursor: 0,
    node: null,
    input: {
      value: "",
      selectionStart: 0,
      selectionEnd: 0,
      selectionDirection: "none",
      setSelectionRange: input.setSelectionRange,
    },
  };
  fields.push(field);
  fields.forEach(renderField);
  return field;
};
const changeField = (field, value, nativeEvent = { isComposing: false }) => {
  multiDocument.activeElement = field.input;
  field.input.value = value;
  field.input.selectionStart = field.input.selectionEnd = value.length;
  field.node.props.onChange({ currentTarget: field.input, nativeEvent });
  fields.forEach(renderField);
};
const firstField = addField();
changeField(firstField, "ㅁㅜㄴㅈㅏㅇ");
assert.equal(firstField.value, "문장");
firstField.node.props.onCompositionStart({ currentTarget: firstField.input });
changeField(firstField, "문장 ㅌㅏㅁㄱㅜ", { isComposing: true });
const secondField = addField();
assert.equal(
  firstField.value,
  "문장 ㅌㅏㅁㄱㅜ",
  "Adding a row must preserve the previous row's latest active Korean input",
);
assert.equal(secondField.value, "");
changeField(secondField, "ㅂㅏㄹㅍㅛ", {});
assert.equal(
  secondField.value,
  "발표",
  "A new row must not inherit another row's active composition state",
);
changeField(firstField, "문장 ㅌㅏㅁㄱㅜ ㅍㅕㅇㄱㅏ", {});
assert.equal(
  firstField.value,
  "문장 ㅌㅏㅁㄱㅜ ㅍㅕㅇㄱㅏ",
  "Another row's commit must not end the first row's active composition",
);
multiDocument.activeElement = firstField.input;
firstField.node.props.onCompositionEnd({ currentTarget: firstField.input });
fields.forEach(renderField);
assert.equal(firstField.value, "문장 탐구 평가");
assert.equal(firstField.input.selectionStart, firstField.value.length);
assert.equal(secondField.value, "발표");

secondField.node.props.onCompositionStart({ currentTarget: secondField.input });
changeField(secondField, "발표 ㅍㅕㅇㄱㅏ", { isComposing: true });
const thirdField = addField();
for (const char of "ㅅㅓㅅㅜㄹㅎㅕㅇ") {
  changeField(thirdField, thirdField.value + char);
}
assert.equal(thirdField.value, "서술형");
assert.equal(firstField.value, "문장 탐구 평가");
assert.equal(secondField.value, "발표 ㅍㅕㅇㄱㅏ");
changeField(secondField, secondField.value, { isComposing: false });
assert.equal(
  secondField.value,
  "발표 평가",
  "A newly added row recovers a missing compositionend independently",
);
changeField(firstField, firstField.value + " ㄱㅣㅈㅜㄴ");
assert.deepEqual(
  fields.map((field) => field.value),
  ["문장 탐구 평가 기준", "발표 평가", "서술형"],
  "All added rows keep their latest Korean text when an earlier row is edited",
);
const fourthField = addField();
changeField(fourthField, "English 123!");
assert.deepEqual(
  fields.map((field) => field.value),
  ["문장 탐구 평가 기준", "발표 평가", "서술형", "English 123!"],
  "Repeated additions retain earlier values and preserve English input",
);
console.log(
  "Korean text input verified: detached/NFD Hangul, incremental syllables/finals/vowels, untouched Latin/word boundaries, active composition, blur, selection, and independent Korean input across repeated row additions.",
);
