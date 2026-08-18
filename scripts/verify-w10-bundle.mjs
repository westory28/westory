import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(path), "utf8");
const countOccurrences = (source, term) => source.split(term).length - 1;
const baseline = JSON.parse(read("scripts/w10-bundle-baseline.json"));

const REFERENCE_BUILDS = {
  productionPresentation: {
    sha: "676869fa289d3e7ecef234cbb5cca65c60ec4597",
    purpose: "actual Production presentation source",
    nodeVersion: "24.13.1",
    npmVersion: "11.8.0",
    viteVersion: "6.4.2",
  },
  w11Functional: {
    sha: "ef74b571a6964ddbc61eb7877a98d21b3c7c8c85",
    purpose: "W11 functional and security source",
    nodeVersion: "24.13.1",
    npmVersion: "11.8.0",
    viteVersion: "6.4.2",
  },
};

const REFERENCE_BUNDLE_BASELINES = {
  mainJs: [170115, 51087],
  mainCss: [334454, 59741],
  studentNote: [6923, 2711],
  studentThinkCloud: [9432, 3675],
  studentPoints: [19060, 5904],
  teacherManagePoints: [183523, 43586],
  teacherManageLesson: [116936, 30330],
  teacherManageSchedule: [12768, 4249],
  teacherManageThinkCloud: [22477, 6054],
  teacherManageExam: [254427, 65165],
  w8StudentHub: [11773, 4010],
  w8TeacherHub: [43208, 11655],
  pdfVendor: [462791, 136818],
  excelVendor: [1048176, 301541],
};

assert.equal(baseline.schemaVersion, 3);
assert.equal(baseline.baselineWave, "W10P");
assert.deepEqual(
  baseline.referenceBuilds,
  REFERENCE_BUILDS,
  "The immutable Production/W11 reference build contract drifted.",
);
assert.deepEqual(
  Object.keys(baseline.budgets).sort(),
  Object.keys(REFERENCE_BUNDLE_BASELINES).sort(),
  "The measured reference bundle inventory drifted.",
);
assert.equal(
  baseline.fontNetworkBudget.baselineBytes,
  287656,
  "The measured Production Font Awesome baseline drifted.",
);
assert.equal(
  existsSync(resolve("dist/assets")),
  true,
  "Run build before bundle verification.",
);

const files = readdirSync(resolve("dist/assets"));
const results = {};
for (const [id, budget] of Object.entries(baseline.budgets)) {
  assert.ok(
    Object.hasOwn(REFERENCE_BUILDS, budget.referenceBuild),
    `${id} names an unknown reference build: ${budget.referenceBuild}`,
  );
  assert.deepEqual(
    [budget.baselineBytes, budget.baselineGzipBytes],
    REFERENCE_BUNDLE_BASELINES[id],
    `${id} immutable reference measurements drifted.`,
  );
  for (const [label, value] of Object.entries({
    baselineBytes: budget.baselineBytes,
    baselineGzipBytes: budget.baselineGzipBytes,
    maxBytes: budget.maxBytes,
    maxGzipBytes: budget.maxGzipBytes,
  })) {
    assert.equal(
      Number.isSafeInteger(value) && value > 0,
      true,
      `${id}.${label} must be a positive safe integer.`,
    );
  }
  assert.ok(
    budget.maxBytes >= budget.baselineBytes,
    `${id} byte ceiling is below its immutable reference measurement.`,
  );
  assert.ok(
    budget.maxGzipBytes >= budget.baselineGzipBytes,
    `${id} gzip ceiling is below its immutable reference measurement.`,
  );
  const byteAllowance = budget.maxBytes / budget.baselineBytes - 1;
  const gzipAllowance = budget.maxGzipBytes / budget.baselineGzipBytes - 1;
  const largestAllowance = Math.max(byteAllowance, gzipAllowance);
  assert.ok(
    largestAllowance <= 0.8,
    `${id} ceiling exceeds the maximum 80% adapter allowance.`,
  );
  if (largestAllowance > 0.3) {
    assert.equal(
      typeof budget.rationale === "string" &&
        budget.rationale.trim().length > 0,
      true,
      `${id} needs a rationale because its adapter allowance exceeds 30%.`,
    );
  }
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
  assert.ok(
    bytes.length <= budget.maxBytes,
    `${id} exceeds byte budget: ${bytes.length} > ${budget.maxBytes}.`,
  );
  assert.ok(
    gzipBytes <= budget.maxGzipBytes,
    `${id} exceeds gzip budget: ${gzipBytes} > ${budget.maxGzipBytes}.`,
  );
  results[id] = {
    file: matches[0],
    bytes: bytes.length,
    gzipBytes,
    referenceBuild: budget.referenceBuild,
    referenceSha: REFERENCE_BUILDS[budget.referenceBuild].sha,
    baselineBytes: budget.baselineBytes,
    baselineGzipBytes: budget.baselineGzipBytes,
    deltaBytes: bytes.length - budget.baselineBytes,
    deltaGzipBytes: gzipBytes - budget.baselineGzipBytes,
    maxBytes: budget.maxBytes,
    maxGzipBytes: budget.maxGzipBytes,
    rationale: budget.rationale ?? null,
  };
}

const fontAwesome = baseline.assetContract.fontAwesome;
const packageJson = JSON.parse(read("package.json"));
const packageLock = JSON.parse(read("package-lock.json"));
const mainSource = read("src/main.tsx");
assert.equal(
  packageJson.dependencies?.[fontAwesome.package],
  fontAwesome.version,
  "Font Awesome must stay exactly pinned in package.json.",
);
assert.equal(
  packageLock.packages?.[""]?.dependencies?.[fontAwesome.package],
  fontAwesome.version,
  "Font Awesome must stay exactly pinned in the lockfile root.",
);
assert.equal(
  packageLock.packages?.[`node_modules/${fontAwesome.package}`]?.version,
  fontAwesome.version,
  "The installed Font Awesome lockfile package version drifted.",
);
assert.equal(
  countOccurrences(mainSource, `import "${fontAwesome.entryImport}";`),
  1,
  "The local Font Awesome stylesheet must be imported exactly once.",
);

const fontNetworkFiles = baseline.fontNetworkBudget.patterns.flatMap(
  (pattern) => files.filter((file) => new RegExp(pattern, "u").test(file)),
);
const uniqueFontNetworkFiles = [...new Set(fontNetworkFiles)];
assert.equal(
  uniqueFontNetworkFiles.length,
  baseline.fontNetworkBudget.expectedFiles,
  `Local Font Awesome WOFF2 asset count drift: ${uniqueFontNetworkFiles.join(", ")}`,
);
const allFontAwesomeWoff2 = files.filter((file) =>
  /^fa-.*\.woff2$/u.test(file),
);
assert.deepEqual(
  [...uniqueFontNetworkFiles].sort(),
  [...allFontAwesomeWoff2].sort(),
  `Unexpected or missing Font Awesome WOFF2 assets: ${allFontAwesomeWoff2.join(", ")}`,
);
const fontNetworkBytes = uniqueFontNetworkFiles.reduce(
  (total, file) => total + readFileSync(resolve("dist/assets", file)).length,
  0,
);
assert.ok(
  fontNetworkBytes <= baseline.fontNetworkBudget.maxBytes,
  `Local WOFF2 network assets exceed budget: ${fontNetworkBytes} > ${baseline.fontNetworkBudget.maxBytes}.`,
);

const mainCss = readFileSync(
  resolve("dist/assets", results.mainCss.file),
  "utf8",
);
assert.match(
  mainCss,
  new RegExp(`Font Awesome Free ${fontAwesome.version}`, "u"),
  "The built stylesheet does not identify the pinned Font Awesome release.",
);
for (const fontFile of uniqueFontNetworkFiles) {
  assert.ok(
    mainCss.includes(fontFile),
    `Built CSS does not reference local Font Awesome asset: ${fontFile}`,
  );
}

const noto = baseline.assetContract.notoSansKr;
const notoSource = read(noto.sourceCss);
assert.ok(
  notoSource.startsWith(`@import url("${noto.importUrl}");`),
  "Noto Sans KR must be the first source CSS import with the frozen weight set.",
);
assert.equal(
  countOccurrences(notoSource, noto.importUrl),
  1,
  "The Tailwind entry must declare the exact Noto Sans KR import once.",
);
assert.equal(
  countOccurrences(mainCss, noto.importUrl),
  noto.expectedBuiltImportCount,
  "The built CSS Noto Sans KR import count drifted.",
);
assert.ok(
  mainCss.startsWith(`@import"${noto.importUrl}";`),
  "The built CSS must preserve the exact Noto Sans KR import before all rules.",
);
const externalBuiltCssImports = [
  ...mainCss.matchAll(
    /@import\s*(?:url\()?\s*["'](https?:\/\/[^"']+)["']\s*\)?\s*;/giu,
  ),
].map((match) => match[1]);
assert.deepEqual(
  externalBuiltCssImports,
  [noto.importUrl],
  `Unexpected external CSS import: ${externalBuiltCssImports.join(", ")}`,
);

const textOutputFiles = [
  "index.html",
  "dist/index.html",
  ...files
    .filter((file) => /\.(?:css|js|mjs)$/u.test(file))
    .map((file) => `dist/assets/${file}`),
];
const textOutputs = textOutputFiles.map((path) => ({
  path,
  source: read(path),
}));
for (const pattern of baseline.assetContract.forbiddenRuntimeCdnPatterns) {
  const expression = new RegExp(pattern, "iu");
  const matches = textOutputs
    .filter(({ source }) => expression.test(source))
    .map(({ path }) => path);
  assert.deepEqual(
    matches,
    [],
    `Forbidden runtime Tailwind/Font Awesome CDN reference (${pattern}): ${matches.join(", ")}`,
  );
}

const app = read("src/App.tsx");
for (const importPath of baseline.requiredLazyImports) {
  assert.equal(
    countOccurrences(app, `import("${importPath}")`),
    1,
    `Lazy route import missing or duplicated: ${importPath}`,
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
    baselineWave: baseline.baselineWave,
    referenceBuilds: REFERENCE_BUILDS,
    chunks: results,
    routeLevelLazyImports: baseline.requiredLazyImports.length,
    initialDeferredDependencyLeaks: 0,
    forbiddenRuntimeCdnReferences: 0,
    typography: {
      notoSansKrImport: noto.importUrl,
      builtImportCount: noto.expectedBuiltImportCount,
    },
    fontAwesome: {
      version: fontAwesome.version,
      files: uniqueFontNetworkFiles,
      bytes: fontNetworkBytes,
      baselineBytes: baseline.fontNetworkBudget.baselineBytes,
      maxBytes: baseline.fontNetworkBudget.maxBytes,
    },
    productionAccess: 0,
  }),
);
