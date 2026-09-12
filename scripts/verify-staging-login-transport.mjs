import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const source = ts.createSourceFile("Login.tsx", readFileSync("src/pages/Login.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["shouldPreferRedirectLogin", "shouldFallbackToRedirectLogin"];
const declarations = source.statements.filter(ts.isVariableStatement).flatMap((statement) => [...statement.declarationList.declarations]).filter((declaration) => names.includes(declaration.name.getText(source)));
assert.equal(declarations.length, 2);
const code = ts.transpileModule(declarations.map((declaration) => `const ${declaration.getText(source)};`).join("\n") + "\n({shouldPreferRedirectLogin,shouldFallbackToRedirectLogin});", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
let checks = 0;
for (const [environment, crossOrigin, local, redirect] of [
  ["staging", true, false, false], ["staging", false, false, true],
  ["production", false, false, true], ["production", true, false, false],
  ["local", false, true, false],
]) {
  const policy = runInNewContext(code, { runtimeEnvironment: environment, hasCrossOriginAuthDomain: () => crossOrigin, isLocalAuthHost: () => local, window: { location: { protocol: "https:" } }, isSafariBrowser: () => false, isIOSDevice: () => false, isAndroidDevice: () => false, isPopupFallbackError: () => true });
  assert.equal(policy.shouldPreferRedirectLogin(), redirect); checks++;
  for (const code of ["auth/popup-blocked", "auth/popup-closed-by-user", "auth/network-request-failed"]) {
    assert.equal(policy.shouldFallbackToRedirectLogin({ code }), crossOrigin ? false : local ? code === "auth/popup-blocked" : true); checks++;
  }
}
console.log(JSON.stringify({ suite: "staging-login-transport", passed: true, checks, networkAccess: 0 }));
