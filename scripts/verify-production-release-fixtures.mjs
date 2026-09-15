import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  validateReleaseReceipt,
  verifyProductionRelease,
} from "./verify-production-release.mjs";

const contents = {
  "index.html":
    '<html><script type="module" src="/assets/main-release1.js"></script></html>',
  "assets/main-release1.js": 'console.log("release fixture")',
};
const receipt = {
  schemaVersion: 1,
  sourceCommit: "a".repeat(40),
  sourceTree: "b".repeat(40),
  sourceArchiveSha256: "c".repeat(64),
  deploymentId: "dpl_fixture",
  firebaseProjectId: "history-quiz-yongsin",
  files: Object.entries(contents).map(([path, data]) => ({
    path,
    bytes: Buffer.byteLength(data),
    sha256: createHash("sha256").update(data).digest("hex"),
  })),
};
const fakeFetch =
  (overrides = {}) =>
  async (url, options) => {
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://www.westory.kr");
    const path = parsed.pathname.slice(1) || "index.html";
    return new Response(overrides[path] ?? contents[path], { status: 200 });
  };
assert.equal(
  (await verifyProductionRelease(receipt, fakeFetch())).status,
  "VERIFIED",
);
await assert.rejects(
  verifyProductionRelease(
    receipt,
    fakeFetch({ "assets/main-release1.js": "wrong build" }),
  ),
  /differs from candidate/,
);
await assert.rejects(
  verifyProductionRelease(receipt, fakeFetch({ "index.html": "old index" })),
  /differs from candidate/,
);
await assert.rejects(
  verifyProductionRelease(
    receipt,
    async () => new Response("Not found", { status: 404 }),
  ),
  /HTTP 404/,
);
const invalid = (change) => {
  const copy = structuredClone(receipt);
  change(copy);
  assert.throws(() => validateReleaseReceipt(copy));
};
invalid((copy) => {
  copy.sourceCommit = "main";
});
invalid((copy) => {
  copy.deploymentId = "latest";
});
invalid((copy) => {
  copy.sourceArchiveSha256 = "";
});
invalid((copy) => {
  copy.firebaseProjectId = "westory-staging-177587430482";
});
invalid((copy) => {
  copy.files[1].path = "assets/../../secrets.js";
});
invalid((copy) => {
  copy.files[1].path = "https://example.com/main.js";
});
invalid((copy) => {
  copy.files.push(copy.files[0]);
});
invalid((copy) => {
  copy.files = copy.files.slice(1);
});
const wrongEntry = structuredClone(receipt);
wrongEntry.files[1].path = "assets/main-other.js";
const wrongEntryFetch = async (url) =>
  new Response(
    url.endsWith("/")
      ? contents["index.html"]
      : contents["assets/main-release1.js"],
  );
await assert.rejects(
  verifyProductionRelease(wrongEntry, wrongEntryFetch),
  /Index main entry is absent/,
);
console.log(
  "Production release verification fixtures: PASS (13 cases, no network)",
);
