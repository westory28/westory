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
const loadLibrary = name => {
  const loaded = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(`src/lib/${name}.ts`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: loaded, exports: loaded.exports, require: dependency => loadLibrary(dependency.replace(/^\.\//, "")) });
  return loaded.exports;
};
const { authStartupFailure } = loadLibrary("authStartup");
for (const emailPatternLabel of ["263NNNN@yongshin-ms.ms.kr", "272NNNN@yongshin-ms.ms.kr"]) {
  const failure = authStartupFailure({ code: "functions/permission-denied",
    details: { reason: "STUDENT_REGISTRATION_EMAIL_NOT_ALLOWED", policy: { emailPatternLabel } } });
  assert.equal(failure.retryable, false);
  assert.ok(render({ error: failure }).includes(emailPatternLabel));
}
const invalidLabel = authStartupFailure({ code: "functions/permission-denied",
  details: { reason: "STUDENT_REGISTRATION_EMAIL_NOT_ALLOWED", policy: { emailPatternLabel: "<unsafe>" } } });
assert.equal(invalidLabel.retryable, false);
assert.doesNotMatch(invalidLabel.message, /unsafe/);
console.log("PASS: pending, rejected, current intake policy and failed sign-in recovery states remain distinct");
