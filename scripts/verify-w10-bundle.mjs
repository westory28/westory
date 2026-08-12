import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(path), "utf8");
const baseline = JSON.parse(read("scripts/w10-bundle-baseline.json"));
assert.equal(baseline.schemaVersion, 1);
assert.equal(
  existsSync(resolve("dist/assets")),
  true,
  "Run build before bundle verification.",
);
const htmlSources = [read("index.html"), read("dist/index.html")];
for (const html of htmlSources) {
  assert.doesNotMatch(
    html,
    /(?:cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)/iu,
    "Runtime CSS, icon, and font dependencies must be bundled locally.",
  );
}
const files = readdirSync(resolve("dist/assets"));
const results = {};
for (const [id, budget] of Object.entries(baseline.budgets)) {
  const matches = files.filter((file) =>
    new RegExp(budget.pattern, "u").test(file),
  );
  assert.equal(
    matches.length,
    1,
    `${id} bundle match count drift: ${matches.join(", ")}`,
  );
  const bytes = readFileSync(resolve("dist/assets", matches[0]));
  const gzipBytes = gzipSync(bytes).length;
  assert.ok(bytes.length <= budget.maxBytes, `${id} exceeds byte budget.`);
  assert.ok(gzipBytes <= budget.maxGzipBytes, `${id} exceeds gzip budget.`);
  results[id] = {
    file: matches[0],
    bytes: bytes.length,
    gzipBytes,
    baselineBytes: budget.baselineBytes,
    deltaBytes: bytes.length - budget.baselineBytes,
  };
}

const fontNetworkFiles = baseline.fontNetworkBudget.patterns.flatMap(
  (pattern) => files.filter((file) => new RegExp(pattern, "u").test(file)),
);
assert.equal(
  new Set(fontNetworkFiles).size,
  baseline.fontNetworkBudget.expectedFiles,
  `Local font network asset count drift: ${fontNetworkFiles.join(", ")}`,
);
const fontNetworkBytes = fontNetworkFiles.reduce(
  (total, file) => total + readFileSync(resolve("dist/assets", file)).length,
  0,
);
assert.ok(
  fontNetworkBytes <= baseline.fontNetworkBudget.maxBytes,
  "Local WOFF2 network assets exceed the W10 budget.",
);

const app = read("src/App.tsx");
for (const importPath of baseline.requiredLazyImports) {
  assert.ok(
    app.includes(`import("${importPath}")`),
    `Lazy route import missing: ${importPath}`,
  );
}
const main = readFileSync(resolve("dist/assets", results.mainJs.file), "utf8");
for (const term of baseline.forbiddenInitialChunkTerms) {
  assert.equal(
    main.includes(term),
    false,
    `Initial chunk includes deferred dependency: ${term}`,
  );
}

console.log(
  JSON.stringify({
    suite: "w10-bundle",
    passed: true,
    chunks: results,
    routeLevelLazyImports: baseline.requiredLazyImports.length,
    initialDeferredDependencyLeaks: 0,
    externalRuntimeCdnReferences: 0,
    fontNetwork: {
      files: fontNetworkFiles,
      bytes: fontNetworkBytes,
      maxBytes: baseline.fontNetworkBudget.maxBytes,
    },
    productionAccess: 0,
  }),
);
