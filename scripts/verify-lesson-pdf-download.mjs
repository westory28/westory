import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
const source = transformSync(readFileSync("src/lib/lessonManagement.ts", "utf8"), { loader: "ts", format: "cjs" }).code;
const bucket = "demo-lesson.firebasestorage.app";
const path = "lesson_uploads/test/source";
const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=fixture`;
const setup = ({ chunks = [new Uint8Array([1, 2])], ok = true } = {}) => {
  let calls = 0, cancelled = 0, index = 0;
  const module = { exports: {} };
  runInNewContext(source, { module, exports: module.exports, URL, Blob, Uint8Array, require: (name) => name === "./firebase" ? { getFirebaseStorage: async () => ({ app: { options: { storageBucket: bucket } } }) } : {}, fetch: async (actual, options) => { calls++; assert.equal(actual, url); assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); return { ok, body: { getReader: () => ({ read: async () => index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }, cancel: async () => { cancelled++; } }) } }; } });
  return { download: module.exports.downloadLessonPdfReference, calls: () => calls, cancelled: () => cancelled };
};
let checks = 0;
for (const invalid of [url.replace("https:", "http:"), url.replace(bucket, "another-bucket"), url.replace("firebasestorage.googleapis.com", "example.com"), url.replace("token=fixture", "token="), url.replace("alt=media", "alt=json")]) { const test = setup(); await assert.rejects(test.download(invalid, path)); assert.equal(test.calls(), 0); checks++; }
const valid = setup(); assert.equal((await valid.download(url, path)).size, 2); assert.equal(valid.cancelled(), 1); checks++;
const large = setup({ chunks: [new Uint8Array(20 * 1024 * 1024), new Uint8Array([1])] }); await assert.rejects(large.download(url, path)); assert.equal(large.cancelled(), 1); checks++;
const failure = setup({ ok: false }); await assert.rejects(failure.download(url, path)); checks++;
console.log(JSON.stringify({ suite: "lesson-pdf-download", passed: true, checks, networkAccess: 0 }));
