const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const calls = [];
const database = {};
const assertSession = () => {};
const exported = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../thinkCloudQuery.js"), "utf8"), {
  module: exported, exports: exported.exports,
  require(name) {
    if (name === "firebase-admin/firestore") return { getFirestore: () => database };
    if (name === "firebase-functions/v2/https") return { HttpsError: class extends Error {
      constructor(code, message, details) { super(message); this.code = code; this.details = details; }
    } };
    if (name === "./studentMaintenance") return { onCallWithStudentMaintenance: (options, handler) => Object.assign(handler, { options }) };
    if (name === "./sessionAuthority") return { assertActiveApplicationSession: assertSession };
    if (name === "./productionGateway/commandGateway") return { createFirestoreStore(db, options) {
      assert.equal(db, database);
      assert.equal(options.readOnly, true, "the isolated query must not lock/wait on mutable classroom transactions");
      return { readOnly: true };
    } };
    if (name === "./productionGateway/w8Domains") return { createW8QueryCore(options) {
      assert.equal(options.assertSession, assertSession, "retain the shared live application-session check");
      assert.equal(options.store.readOnly, true);
      return { async getW8DomainState(request) { calls.push(request); return { marker: "checked-core" }; } };
    } };
    throw new Error(`Unexpected dependency: ${name}`);
  },
});

(async () => {
  const endpoint = exported.exports.getThinkCloudState;
  assert.equal(endpoint.options.region, "asia-northeast3");
  const request = {
    auth: { uid: "synthetic-student" },
    data: { semesterId: "2026-2", domain: "LEARNING", source: "CURRENT", audience: "student", projection: "think-cloud", _session: { revision: "synthetic-proof" } },
  };
  const result = await endpoint(request);
  assert.equal(result.marker, "checked-core");
  assert.equal(calls[0], request, "forward the original authenticated request and session proof");
  await endpoint({ ...request, data: { ...request.data, projection: "think-cloud-command", sessionId: "topic-1" } });
  for (const patch of [
    { source: "EXPLICIT" }, { source: "ARCHIVE" }, { source: "LEGACY" },
    { domain: "DASHBOARD" }, { projection: undefined }, { projection: "full" },
    { studentUid: "another-student" }, { classId: "another-class" },
  ]) {
    await assert.rejects(endpoint({ ...request, data: { ...request.data, ...patch } }),
      (error) => error.code === "invalid-argument" && error.details.reason === "THINK_CLOUD_QUERY_SCOPE_INVALID");
  }
  assert.equal(calls.length, 2, "unsupported domains and broader scopes never reach the shared core");
  console.log("PASS isolated current Think Cloud endpoint, preserved session identity, read-only store and rejected broad/archived queries");
})().catch((error) => { console.error(error); process.exitCode = 1; });
