import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(path), "utf8");
const policy = JSON.parse(read("scripts/w10-ui-quality-policy.json"));
assert.equal(policy.schemaVersion, 1);
assert.match(policy.baselineSha, /^[a-f0-9]{40}$/u);
assert.equal(new Set(policy.requiredTokens).size, policy.requiredTokens.length);
assert.equal(
  new Set(policy.antiSlopAdditionPatterns.map((item) => item.id)).size,
  policy.antiSlopAdditionPatterns.length,
);

const tokenSources = policy.tokenSources.map(read).join("\n");
for (const token of policy.requiredTokens) {
  assert.ok(tokenSources.includes(token), `Missing Westory token: ${token}`);
}

const diff = execFileSync(
  "git",
  ["diff", "--unified=0", policy.baselineSha, "--", ...policy.frontendRoots],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
);
let currentFile = "";
let nextLine = 0;
const additions = [];
for (const line of diff.split(/\r?\n/u)) {
  const file = line.match(/^\+\+\+ b\/(.+)$/u)?.[1];
  if (file) {
    currentFile = file.replaceAll("\\", "/");
    continue;
  }
  const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/u);
  if (hunk) {
    nextLine = Number(hunk[1]);
    continue;
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    additions.push({ file: currentFile, line: nextLine, text: line.slice(1) });
    nextLine += 1;
  } else if (!line.startsWith("-")) {
    nextLine += 1;
  }
}

const exceptionKeys = new Set(
  policy.approvedAdditionExceptions.map(
    (item) => `${item.ruleId}\n${item.file}\n${item.line}`,
  ),
);
const violations = [];
for (const rule of policy.antiSlopAdditionPatterns) {
  const pattern = new RegExp(rule.pattern, "iu");
  for (const addition of additions) {
    if (!pattern.test(addition.text)) continue;
    const key = `${rule.id}\n${addition.file}\n${addition.line}`;
    if (!exceptionKeys.has(key))
      violations.push({ ruleId: rule.id, ...addition });
  }
}
assert.deepEqual(
  violations,
  [],
  `W10 anti-slop violations: ${JSON.stringify(violations)}`,
);

const app = read("src/App.tsx");
const shell = read("src/components/shell/AppShell.tsx");
const dialog = read("src/components/common/AppDialogProvider.tsx");
const formField = read("src/components/common/FormField.tsx");
const modalSurface = read("src/components/common/ModalSurface.tsx");
const access = read("src/components/auth/ProtectedAccessBoundary.tsx");
const css = read("assets/css/style.css");
const domainCss = read("src/pages/w8Domains.css");
assert.match(shell, /ws-skip-link/u);
assert.match(shell, /aria-current=\{active \? "page"/u);
assert.match(dialog, /aria-modal="true"/u);
assert.match(dialog, /event\.key === "Escape"/u);
assert.match(dialog, /opener\?\.focus\?\.\(\)/u);
assert.match(formField, /<label[\s\S]*?htmlFor=\{htmlFor\}/u);
assert.match(formField, /"aria-describedby"/u);
assert.match(formField, /"aria-invalid"/u);
assert.match(formField, /role="alert"/u);
assert.match(modalSurface, /<dialog/u);
assert.match(modalSurface, /dialog\.showModal\(\)/u);
assert.match(modalSurface, /aria-labelledby=\{titleId\}/u);
assert.match(modalSurface, /onCancel=/u);
assert.match(modalSurface, /event\.key !== "Tab"/u);
assert.match(modalSurface, /openerRef\.current\?\.focus\?\.\(\)/u);
assert.match(access, /state="PERMISSION"/u);
assert.match(app, /const NotFound/u);
assert.match(css, /min-width:\s*44px/u);
assert.match(css, /min-height:\s*44px/u);
assert.match(css, /:focus-visible/u);
assert.match(css, /prefers-reduced-motion:\s*reduce/u);
assert.match(domainCss, /:focus-visible/u);
assert.match(domainCss, /prefers-reduced-motion:\s*reduce/u);

console.log(
  JSON.stringify({
    suite: "w10-ui-quality",
    passed: true,
    changedAdditionLines: additions.length,
    antiSlopRules: policy.antiSlopAdditionPatterns.length,
    antiSlopViolations: 0,
    tokenSources: policy.tokenSources.length,
    requiredTokens: policy.requiredTokens.length,
    accessibilityStaticChecks: 22,
    productionAccess: 0,
  }),
);
