import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
  let actualPixelSize = null;
  let sawImageData = false;
  let sawEnd = false;
  while (offset < png.length) {
    assert.ok(offset + 12 <= png.length, `${label} has a truncated PNG chunk.`);
    const length = png.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    assert.ok(
      chunkEnd <= png.length,
      `${label} has an invalid PNG chunk length.`,
    );
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    assert.match(
      type,
      /^[A-Za-z]{4}$/u,
      `${label} has an invalid PNG chunk type.`,
    );
    assert.equal(
      png.readUInt32BE(offset + 8 + length),
      crc32(png.subarray(offset + 4, offset + 8 + length)),
      `${label} ${type} chunk CRC is invalid.`,
    );
    if (chunkIndex === 0) {
      assert.equal(type, "IHDR", `${label} has no leading IHDR chunk.`);
      assert.equal(length, 13, `${label} has an invalid IHDR length.`);
      actualPixelSize = {
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
  assert.equal(sawImageData, true, `${label} has no IDAT image data.`);
  assert.equal(sawEnd, true, `${label} has no IEND chunk.`);
  return actualPixelSize;
};
const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const schema = readJson("scripts/w11-staging-evidence-schema.json");
const viewportKey = ({ width, height }) => `${width}x${height}`;
const validDate = (value, label) => {
  assert.equal(typeof value, "string", `${label} must be a timestamp string.`);
  const timestamp = Date.parse(value);
  assert.equal(Number.isNaN(timestamp), false, `${label} must be a timestamp.`);
  return timestamp;
};

export const assertW11DeploymentProvenance = (
  document,
  label = "deployment provenance",
) => {
  for (const field of schema.browserProvenanceRequired) {
    assert.ok(field in document, `${label} missing ${field}.`);
  }
  const contract = schema.deploymentProvenance;
  assert.equal(document.projectId, contract.firebaseProjectId);
  assert.equal(document.stableAlias, contract.stableAlias);
  assert.equal(
    document.observedAliasOrigin,
    contract.stableAlias,
    `${label} was not observed through the fixed Dedicated Staging alias.`,
  );
  assert.equal(
    document.deploymentUrl,
    document.immutableDeploymentUrl,
    `${label} deploymentUrl must be the immutable deployment URL.`,
  );
  assert.notEqual(
    document.immutableDeploymentUrl,
    document.stableAlias,
    `${label} cannot use only the mutable stable alias.`,
  );
  assert.match(
    document.immutableDeploymentUrl,
    new RegExp(contract.immutableDeploymentUrlPattern, "u"),
    `${label} has no immutable Vercel deployment URL.`,
  );
  assert.match(
    document.deploymentId,
    new RegExp(contract.deploymentIdPattern, "u"),
    `${label} has no Vercel deployment ID.`,
  );
  assert.equal(document.vercelProjectId, contract.vercelProjectId);
  assert.equal(document.vercelOrgId, contract.vercelOrgId);
  assert.equal(
    document.aliasTargetDeploymentId,
    document.deploymentId,
    `${label} stable alias must resolve to the inspected deployment ID.`,
  );
  validDate(document.inspectedAt, `${label}.inspectedAt`);
  assert.match(document.commitSha, /^[a-f0-9]{40}$/u);
  assert.match(document.sourceCommitSha, /^[a-f0-9]{40}$/u);
  assert.equal(
    document.commitSha,
    document.sourceCommitSha,
    `${label} source commit SHA drift.`,
  );
};

const assertExpected = (manifest, expected) => {
  for (const [field, expectedValue] of Object.entries(expected || {})) {
    if (expectedValue === undefined) continue;
    assert.equal(
      manifest[field],
      expectedValue,
      `screenshot-manifest.json ${field} drift.`,
    );
  }
};

export const verifyW11ScreenshotManifest = ({
  manifestPath,
  screenshotsRoot = dirname(resolve(manifestPath)),
  expected = {},
  completedAt,
}) => {
  const absoluteManifestPath = resolve(manifestPath);
  const absoluteScreenshotsRoot = resolve(screenshotsRoot);
  assert.equal(
    existsSync(absoluteManifestPath),
    true,
    "Missing screenshot-manifest.json.",
  );
  assert.equal(
    statSync(absoluteScreenshotsRoot).isDirectory(),
    true,
    "Screenshot root must be a directory.",
  );
  const manifest = readJson(absoluteManifestPath);
  for (const field of schema.screenshotManifestRequired) {
    assert.ok(field in manifest, `screenshot-manifest.json missing ${field}.`);
  }
  assert.equal(manifest.schemaVersion, schema.schemaVersion);
  assert.match(manifest.testRunId, new RegExp(schema.testRunIdPattern, "u"));
  assertW11DeploymentProvenance(manifest, "screenshot-manifest.json");
  assertExpected(manifest, expected);
  assert.equal(
    Array.isArray(manifest.screenshots),
    true,
    "screenshot-manifest.json screenshots must be an array.",
  );
  assert.equal(
    manifest.screenshots.length,
    schema.requiredViewports.length,
    "One screenshot is required for each of the five viewports.",
  );

  const expectedViewports = schema.requiredViewports.map(viewportKey).sort();
  const observedViewports = [];
  const observedFiles = new Set();
  const inspectedAt = validDate(
    manifest.inspectedAt,
    "screenshot-manifest.json.inspectedAt",
  );
  const completedTimestamp = completedAt
    ? validDate(completedAt, "metadata.completedAt")
    : null;

  for (const screenshot of manifest.screenshots) {
    for (const field of schema.screenshotRequired) {
      assert.ok(field in screenshot, `Screenshot entry missing ${field}.`);
    }
    assert.equal(
      screenshot.fileName,
      basename(screenshot.fileName),
      "Screenshot fileName cannot contain a path.",
    );
    assert.match(screenshot.fileName, /^[a-z0-9][a-z0-9-]*\.png$/u);
    assert.equal(
      observedFiles.has(screenshot.fileName),
      false,
      `Duplicate screenshot fileName: ${screenshot.fileName}`,
    );
    observedFiles.add(screenshot.fileName);
    assert.equal(
      screenshot.route,
      schema.requiredScreenshotRoute,
      `${screenshot.fileName} must show the W11 cutover center route.`,
    );
    assert.equal(
      screenshot.observedOrigin,
      manifest.observedAliasOrigin,
      `${screenshot.fileName} was not captured through the fixed alias origin.`,
    );
    assert.equal(Number.isInteger(screenshot.viewport?.width), true);
    assert.equal(Number.isInteger(screenshot.viewport?.height), true);
    const key = viewportKey(screenshot.viewport);
    observedViewports.push(key);
    assert.equal(
      screenshot.fileName,
      `teacher-cutover-${key}.png`,
      `${screenshot.fileName} does not identify the W11 cutover viewport ${key}.`,
    );
    assert.equal(screenshot.dpr, schema.requiredDpr);
    assert.equal(screenshot.fullPage, schema.requiredFullPage);
    assert.deepEqual(
      screenshot.actualPixelSize,
      screenshot.viewport,
      `${screenshot.fileName} actualPixelSize must equal viewport at DPR 1.`,
    );
    assert.match(screenshot.sha256, /^[a-f0-9]{64}$/u);
    assert.match(screenshot.sourceCommitSha, /^[a-f0-9]{40}$/u);
    assert.equal(screenshot.sourceCommitSha, manifest.sourceCommitSha);
    const capturedAt = validDate(
      screenshot.capturedAt,
      `${screenshot.fileName}.capturedAt`,
    );
    assert.ok(
      capturedAt >= inspectedAt,
      `${screenshot.fileName} predates the deployment inspection.`,
    );
    if (completedTimestamp !== null) {
      assert.ok(
        capturedAt <= completedTimestamp,
        `${screenshot.fileName} was captured after evidence completion.`,
      );
    }

    const imagePath = resolve(absoluteScreenshotsRoot, screenshot.fileName);
    assert.equal(
      existsSync(imagePath),
      true,
      `Missing ${screenshot.fileName}.`,
    );
    assert.equal(
      statSync(imagePath).isFile(),
      true,
      `${screenshot.fileName} is not a file.`,
    );
    const png = readFileSync(imagePath);
    const actualPixelSize = inspectPng(png, screenshot.fileName);
    assert.deepEqual(
      actualPixelSize,
      screenshot.actualPixelSize,
      `${screenshot.fileName} IHDR pixel size drift.`,
    );
    assert.equal(
      createHash("sha256").update(png).digest("hex"),
      screenshot.sha256,
      `${screenshot.fileName} sha256 drift.`,
    );
    assert.equal(
      screenshot.status,
      "PASS",
      `${screenshot.fileName} is not a verified PASS screenshot.`,
    );
  }

  assert.deepEqual(
    observedViewports.sort(),
    expectedViewports,
    "Screenshot evidence must cover exactly the five required viewports.",
  );
  const pngFiles = readdirSync(absoluteScreenshotsRoot, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"),
    )
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(
    pngFiles,
    [...observedFiles].sort(),
    "Every PNG in the screenshot root must be represented exactly once in the manifest.",
  );
  assert.equal(
    manifest.status,
    "PASS",
    "screenshot-manifest.json cannot be PASS until every PNG passes integrity checks.",
  );

  return {
    manifest,
    screenshotFiles: [...observedFiles],
    viewportCount: expectedViewports.length,
  };
};

const args = process.argv.slice(2);
const value = (name) =>
  String(
    args
      .find((item) => item.startsWith(`--${name}=`))
      ?.slice(name.length + 3) || "",
  ).trim();
const isMain =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const manifestPath = value("manifest");
  assert.ok(manifestPath, "--manifest is required.");
  const screenshotsRoot =
    value("screenshots-root") || dirname(resolve(manifestPath));
  const testRunId = value("test-run-id");
  const result = verifyW11ScreenshotManifest({
    manifestPath,
    screenshotsRoot,
    expected: testRunId ? { testRunId } : {},
  });
  console.log(
    JSON.stringify({
      suite: "w11-screenshot-manifest-verify",
      passed: true,
      testRunId: result.manifest.testRunId,
      screenshots: result.screenshotFiles.length,
      viewports: result.viewportCount,
      dpr: schema.requiredDpr,
      fullPage: schema.requiredFullPage,
    }),
  );
}
