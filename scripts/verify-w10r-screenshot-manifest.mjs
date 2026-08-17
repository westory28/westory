import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const contract = readJson("scripts/w10r-screenshot-contract.json");
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const inspectPng = (png, label) => {
  assert.ok(png.length >= 57, `${label} is too small to be a complete PNG.`);
  assert.equal(
    png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE),
    true,
    `${label} has no PNG signature.`,
  );
  let offset = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let size = null;
  let sawImageData = false;
  let sawEnd = false;
  while (offset < png.length) {
    assert.ok(offset + 12 <= png.length, `${label} has a truncated PNG chunk.`);
    const length = png.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    assert.ok(chunkEnd <= png.length, `${label} has an invalid chunk length.`);
    const typeBytes = png.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    assert.match(type, /^[A-Za-z]{4}$/u, `${label} has an invalid chunk type.`);
    assert.equal(
      png.readUInt32BE(offset + 8 + length),
      crc32(png.subarray(offset + 4, offset + 8 + length)),
      `${label} ${type} CRC is invalid.`,
    );
    if (chunkIndex === 0) {
      assert.equal(type, "IHDR", `${label} has no leading IHDR chunk.`);
      assert.equal(length, 13, `${label} has an invalid IHDR length.`);
      size = {
        width: png.readUInt32BE(offset + 8),
        height: png.readUInt32BE(offset + 12),
      };
    } else {
      assert.notEqual(type, "IHDR", `${label} has more than one IHDR chunk.`);
    }
    if (type === "IDAT") sawImageData = true;
    if (type === "IEND") {
      assert.equal(length, 0, `${label} has an invalid IEND length.`);
      assert.equal(chunkEnd, png.length, `${label} has bytes after IEND.`);
      sawEnd = true;
    }
    offset = chunkEnd;
    chunkIndex += 1;
  }
  assert.equal(sawImageData, true, `${label} has no IDAT data.`);
  assert.equal(sawEnd, true, `${label} has no IEND chunk.`);
  return size;
};

const args = process.argv.slice(2);
const manifestArg = args
  .find((item) => item.startsWith("--manifest="))
  ?.slice("--manifest=".length);
assert.ok(manifestArg, "--manifest=<path> is required.");

const manifestPath = resolve(manifestArg);
const screenshotRoot = dirname(manifestPath);
assert.equal(existsSync(manifestPath), true, "Screenshot manifest is missing.");
assert.equal(statSync(screenshotRoot).isDirectory(), true);
const manifest = readJson(manifestPath);

assert.equal(manifest.schemaVersion, contract.schemaVersion);
assert.equal(manifest.phase, contract.phase);
assert.match(manifest.testRunId, /^w10r-[a-z0-9][a-z0-9-]{7,63}$/u);
assert.equal(manifest.branch, "codex/phase6-w10r-ui-recovery");
assert.match(manifest.sourceCommitSha, /^[a-f0-9]{40}$/u);
assert.equal(
  manifest.functionalBaselineSha,
  "ef74b571a6964ddbc61eb7877a98d21b3c7c8c85",
);
assert.equal(
  manifest.visualBaselineSha,
  "c735055608cdc06bd2b6324f92662f88149f6966",
);
assert.equal(manifest.projectId, contract.projectId);
assert.equal(manifest.stableAlias, contract.stableAlias);
assert.match(
  manifest.deploymentUrl,
  /^https:\/\/westory-staging-[a-z0-9]{9,}-bbbs-projects-44f9da30\.vercel\.app\/?$/u,
);
assert.notEqual(manifest.deploymentUrl, manifest.stableAlias);
assert.match(manifest.deploymentId, /^dpl_[A-Za-z0-9]{20,}$/u);
assert.equal(Number.isNaN(Date.parse(manifest.capturedAt)), false);
assert.equal(manifest.status, "PASS");
assert.equal(Array.isArray(manifest.uxCritiques), true);
assert.equal(manifest.uxCritiques.length, contract.screens.length);
for (const critique of manifest.uxCritiques) {
  assert.ok(contract.screens.some((screen) => screen.id === critique.screenId));
  assert.ok(String(critique.summary || "").trim().length >= 30);
  assert.equal(critique.status, "PASS");
}

const expectedKeys = new Set(
  contract.screens.flatMap((screen) =>
    contract.viewports.map(
      (viewport) => `${screen.id}:${viewport.width}x${viewport.height}`,
    ),
  ),
);
assert.equal(Array.isArray(manifest.screenshots), true);
assert.equal(manifest.screenshots.length, expectedKeys.size);

const observedKeys = new Set();
const observedFiles = new Set();
for (const entry of manifest.screenshots) {
  const screen = contract.screens.find((item) => item.id === entry.screenId);
  assert.ok(screen, `Unknown screen: ${entry.screenId}`);
  assert.equal(entry.role, screen.role);
  assert.equal(entry.route, screen.route);
  assert.equal(entry.dpr, contract.requiredDpr);
  assert.equal(entry.fullPage, contract.requiredFullPage);
  assert.equal(entry.status, "PASS");
  assert.equal(entry.overflowX, 0);
  assert.equal(Number.isNaN(Date.parse(entry.capturedAt)), false);
  assert.equal(entry.sourceCommitSha, manifest.sourceCommitSha);
  assert.equal(entry.observedOrigin, manifest.stableAlias);
  assert.equal(Number.isInteger(entry.viewport?.width), true);
  assert.equal(Number.isInteger(entry.viewport?.height), true);
  assert.deepEqual(entry.actualPixelSize, entry.viewport);
  assert.ok(
    contract.viewports.some(
      (viewport) =>
        viewport.width === entry.viewport.width &&
        viewport.height === entry.viewport.height,
    ),
    `Unexpected viewport: ${entry.viewport.width}x${entry.viewport.height}`,
  );
  const viewportKey = `${entry.viewport.width}x${entry.viewport.height}`;
  const key = `${entry.screenId}:${viewportKey}`;
  assert.equal(expectedKeys.has(key), true);
  assert.equal(observedKeys.has(key), false, `Duplicate screen viewport: ${key}`);
  observedKeys.add(key);

  const expectedFileName = `${entry.screenId}-${viewportKey}.png`;
  assert.equal(entry.fileName, expectedFileName);
  assert.equal(entry.fileName, basename(entry.fileName));
  assert.equal(observedFiles.has(entry.fileName), false);
  observedFiles.add(entry.fileName);
  assert.match(entry.sha256, /^[a-f0-9]{64}$/u);

  const pngPath = resolve(screenshotRoot, entry.fileName);
  assert.equal(existsSync(pngPath), true, `Missing ${entry.fileName}.`);
  const png = readFileSync(pngPath);
  assert.deepEqual(inspectPng(png, entry.fileName), entry.actualPixelSize);
  assert.equal(
    createHash("sha256").update(png).digest("hex"),
    entry.sha256,
    `${entry.fileName} sha256 drift.`,
  );
}
assert.deepEqual([...observedKeys].sort(), [...expectedKeys].sort());

const pngFiles = readdirSync(screenshotRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
  .map((entry) => entry.name)
  .sort();
assert.deepEqual(
  pngFiles,
  [...observedFiles].sort(),
  "Every PNG must be represented exactly once in the manifest.",
);

console.log(
  JSON.stringify({
    suite: "w10r-screenshot-manifest",
    passed: true,
    testRunId: manifest.testRunId,
    screens: contract.screens.length,
    viewports: contract.viewports.length,
    screenshots: manifest.screenshots.length,
    dpr: contract.requiredDpr,
    fullPage: contract.requiredFullPage,
  }),
);
