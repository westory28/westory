import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadConfigFromFile } from "vite";

const config = JSON.parse(readFileSync("vercel.json", "utf8"));
const headers = (source) => Object.fromEntries(
  config.headers.find((entry) => entry.source === source).headers.map(({ key, value }) => [key, value]),
);
assert.equal(headers("/(.*)")["X-Content-Type-Options"], "nosniff");
for (const source of ["/", "/index.html"]) {
  assert.equal(headers(source)["X-Frame-Options"], "SAMEORIGIN");
  const policy = headers(source)["Content-Security-Policy"];
  assert.match(policy, /frame-ancestors 'self'/);
  assert.match(policy, /base-uri 'self'/);
  assert.match(policy, /object-src 'none'/);
  // Firebase popups/helpers and PDF workers keep their existing load policy.
  assert.doesNotMatch(policy, /(?:default|script|connect|worker|frame)-src|form-action/);
}
assert.equal(headers("/(.*)")["Content-Security-Policy"], undefined);
assert.deepEqual(config.rewrites, [{
  source: "/__/auth/:path*",
  destination: "https://history-quiz-yongsin.firebaseapp.com/__/auth/:path*",
}]);
assert.equal(headers("/assets/westory-:file*")["Cache-Control"], "public, max-age=31536000, immutable");

const sentinel = "westory-security-test-not-a-secret";
const previous = process.env.GEMINI_API_KEY;
process.env.GEMINI_API_KEY = sentinel;
try {
  const resolved = await loadConfigFromFile({ command: "build", mode: "production" });
  assert.ok(resolved);
  assert.equal(resolved.config.server.host, "127.0.0.1");
  assert.equal(resolved.config.define?.["process.env.API_KEY"], undefined);
  assert.equal(resolved.config.define?.["process.env.GEMINI_API_KEY"], undefined);
  assert.ok(!JSON.stringify(resolved.config).includes(sentinel));
} finally {
  if (previous === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = previous;
}
console.log("Security configuration passed: document framing, MIME, auth proxy, cache, and private environment boundary.");
