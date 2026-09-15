import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export function validateReleaseReceipt(receipt) {
  assert.equal(receipt.schemaVersion, 1, "Unsupported release receipt");
  assert.match(
    receipt.sourceCommit,
    /^[a-f0-9]{40}$/,
    "Full source commit required",
  );
  assert.match(receipt.sourceTree, /^[a-f0-9]{40}$/, "Source tree required");
  assert.match(
    receipt.sourceArchiveSha256,
    /^[a-f0-9]{64}$/,
    "Source archive hash required",
  );
  assert.match(
    receipt.deploymentId,
    /^dpl_[A-Za-z0-9]+$/,
    "Deployment ID required",
  );
  assert.equal(receipt.firebaseProjectId, "history-quiz-yongsin");
  assert.ok(Array.isArray(receipt.files) && receipt.files.length >= 2);
  const paths = new Set();
  for (const file of receipt.files) {
    assert.match(
      file.path,
      /^(?:index\.html|assets\/[A-Za-z0-9_.-]+\.(?:js|css))$/,
    );
    assert.ok(!paths.has(file.path), `Duplicate file: ${file.path}`);
    paths.add(file.path);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0);
  }
  assert.ok(paths.has("index.html"), "index.html is required");
  assert.ok(
    receipt.files.some((file) => /^assets\/main-[\w-]+\.js$/.test(file.path)),
    "Main entry required",
  );
  return receipt;
}

export async function verifyProductionRelease(receipt, fetcher = fetch) {
  validateReleaseReceipt(receipt);
  const origin = "https://www.westory.kr";
  const files = [];
  let index = "";
  for (const expected of receipt.files) {
    const url = `${origin}/${expected.path === "index.html" ? "" : expected.path}`;
    const response = await fetcher(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(
      response.status,
      200,
      `${expected.path}: HTTP ${response.status}`,
    );
    const data = Buffer.from(await response.arrayBuffer());
    const actual = {
      path: expected.path,
      bytes: data.length,
      sha256: sha256(data),
    };
    assert.deepEqual(
      actual,
      expected,
      `Production differs from candidate: ${expected.path}`,
    );
    if (expected.path === "index.html") index = data.toString("utf8");
    files.push(actual);
  }
  const entry = [...index.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .find((path) => /^\/assets\/main-[\w-]+\.js$/.test(path));
  assert.ok(entry, "Production index has no expected Vite main entry");
  assert.ok(
    files.some((file) => `/${file.path}` === entry),
    "Index main entry is absent from receipt",
  );
  return {
    schemaVersion: 1,
    status: "VERIFIED",
    checkedAt: new Date().toISOString(),
    sourceCommit: receipt.sourceCommit,
    sourceTree: receipt.sourceTree,
    sourceArchiveSha256: receipt.sourceArchiveSha256,
    deploymentId: receipt.deploymentId,
    origin,
    files,
    scope:
      "Public files match the recorded candidate. Source provenance and deployment ownership require the candidate preparation and provider inspection records.",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    assert.equal(
      args.length,
      4,
      "Usage: node scripts/verify-production-release.mjs --receipt <candidate.json> --output <result.json>",
    );
    assert.equal(args[0], "--receipt");
    assert.equal(args[2], "--output");
    assert.notEqual(
      resolve(args[1]),
      resolve(args[3]),
      "Keep candidate and verification records separate",
    );
    const receipt = JSON.parse(readFileSync(args[1], "utf8"));
    const result = await verifyProductionRelease(receipt);
    writeFileSync(args[3], `${JSON.stringify(result, null, 2)}\n`, {
      flag: "wx",
    });
    console.log(
      `Production release verified: ${result.sourceCommit} (${result.files.length} files)`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
