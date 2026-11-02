import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

const require = createRequire(import.meta.url);
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(
  readFileSync("src/components/common/AuthRecoveryState.tsx", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } },
).outputText, { module, exports: module.exports, require });
const render = (props) => renderToStaticMarkup(React.createElement(module.exports.default, {
  error: null, onRetry: async () => {}, onRestart: async () => {}, ...props,
}));
const pending = render({ registrationPending: true });
assert.match(pending, /등록 승인 대기/);
assert.match(pending, /선생님의 등록 승인이 필요합니다/);
const rejected = render({ registrationPending: true, registrationRejected: true });
assert.match(rejected, /가입 신청 거부/);
assert.match(rejected, /가입 신청이 거부되었습니다/);
assert.doesNotMatch(rejected, /등록 승인 대기/);
assert.match(rejected, /로그아웃/);
assert.match(render({ error: { message: "연결 오류", retryable: true } }), /연결 오류/);
console.log("PASS: pending, rejected and failed sign-in recovery states remain distinct");
