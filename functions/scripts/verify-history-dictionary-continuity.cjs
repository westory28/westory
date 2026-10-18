const assert = require("node:assert/strict");
const { HttpsError } = require("firebase-functions/v2/https");
const { FieldPath } = require("firebase-admin/firestore");
const { createHash } = require("node:crypto");
const { gzipSync } = require("node:zlib");
const {
  createHistoryDictionaryContinuityHandler, CATALOG_COLLECTION, PAGE_SIZE, CATALOG_PAGE_SIZE,
  CATALOG_BATCH_SIZE, CATALOG_BATCH_BYTES, CATALOG_SNAPSHOT_COLLECTION, CATALOG_SNAPSHOT_MAX_BYTES,
  CATALOG_SNAPSHOT_MAX_ITEMS, CATALOG_SNAPSHOT_MAX_CHUNKS, CATALOG_CHUNK_MAX_CHARS,
} = require("../historyDictionaryContinuity");

// The production handler is exercised with an in-memory Firestore query model.
// No Firebase app, credentials, network connection, or production writes occur.
const uid = "student-one";
const current = { year: "2026", semester: "2" };
const past = { year: "2026", semester: "1" };
const stamp = { seconds: 100, nanoseconds: 5 };
const termPath = (key, source = current) => `years/${source.year}/semesters/${source.semester}/history_dictionary_terms/${key}`;
const wordPath = (key, owner = uid, source = current) => `years/${source.year}/semesters/${source.semester}/dictionary_students/${owner}/history_dictionary_words/${key}`;
const record = (source = current, extra = {}) => ({
  ...source, uid, word: "율령", normalizedWord: "율령", definition: "법과 행정 규정",
  status: "saved", definitionSource: "student", tags: ["정치"], createdAt: stamp, updatedAt: stamp, ...extra,
});
const term = (source = current, extra = {}) => record(source, { status: "published", ...extra });
const catalogRecord = (key, extra = {}) => ({
  id: key, kind: "history",
  word: key, definition: "검증용 뜻풀이", aliases: [], tags: [], facetIds: [], attributions: [], ...extra,
});
const batchRequest = extra => request("catalog", { catalogMode: "batch", ...extra });
const request = (kind = "terms", extra = {}) => ({
  auth: { uid, token: { email: `${uid}@yongshin-ms.ms.kr` } },
  data: { ...current, kind, _session: { sessionId: "test-session", sessionVersion: 1 }, ...extra },
});
const code = expected => error => error.code === expected;
const tests = [];
const test = (name, run) => tests.push({ name, run });

function fixture({ role = "student", profile = {}, sessionError, queryError, beforeQuery, beforeGetAll, snapshotReadError } = {}) {
  const controls = { sessionError, queryError, beforeQuery, beforeGetAll, snapshotReadError };
  const documents = new Map([
    [`users/${uid}`, { uid, role, ...profile }],
    ["site_settings/semester_active", { semesterId: "2026-2", revision: 3 }],
    ["semester_manifests/2026-2", { semesterId: "2026-2", revision: 3, status: "ACTIVE" }],
    ["semester_manifests/2026-1", { semesterId: "2026-1", revision: 2, status: "ARCHIVED" }],
  ]);
  const events = [], queries = [], reads = [];
  const snapshot = path => ({
    id: path.split("/").at(-1), ref: { path }, exists: documents.has(path),
    data: () => documents.has(path) ? structuredClone(documents.get(path)) : undefined,
  });
  const buildQuery = (collection, group) => {
    const definition = { collection, group, filters: [], after: "", limit: undefined, order: undefined };
    const query = {
      where(field, operator, value) { definition.filters.push({ field, operator, value }); return query; },
      orderBy(field) { definition.order = field; return query; },
      startAfter(ref) { definition.after = ref.path; return query; },
      limit(value) { definition.limit = value; return query; },
      async get() {
        events.push("query");
        queries.push(definition);
        assert.ok(definition.order.isEqual(FieldPath.documentId()), "Use a stable document-ID order");
        assert.ok(Number.isSafeInteger(definition.limit) && definition.limit > 0, "Every query is bounded");
        if (controls.beforeQuery) await controls.beforeQuery();
        if (controls.queryError) throw controls.queryError;
        const paths = [...documents.keys()].filter(path => {
          const parts = path.split("/");
          if (group ? parts.at(-2) !== collection : parts.length !== 2 || parts[0] !== collection) return false;
          return definition.filters.every(({ field, operator, value }) => {
            assert.equal(operator, "==");
            return documents.get(path)[field] === value;
          });
        }).sort().filter(path => !definition.after || path > definition.after).slice(0, definition.limit);
        return { docs: paths.map(snapshot), size: paths.length, empty: paths.length === 0 };
      },
    };
    return query;
  };
  const db = {
    doc(path) { events.push("doc"); return { path }; },
    async getAll(...refs) {
      events.push("getAll"); reads.push(...refs.map(ref => ref.path));
      if (controls.beforeGetAll) await controls.beforeGetAll(refs);
      if (controls.snapshotReadError && refs.some(ref => ref.path.startsWith(`${CATALOG_SNAPSHOT_COLLECTION}/`))) throw controls.snapshotReadError;
      return refs.map(ref => snapshot(ref.path));
    },
    collection: name => buildQuery(name, false),
    collectionGroup: name => buildQuery(name, true),
  };
  const handler = createHistoryDictionaryContinuityHandler({
    db,
    assertSession: async incoming => {
      events.push("session");
      assert.equal(incoming.data._session.sessionId, "test-session");
      if (controls.sessionError) throw controls.sessionError;
    },
  });
  return { documents, events, queries, reads, handler, controls };
}

function publishSnapshot(f, entries, { chunkSize = CATALOG_CHUNK_MAX_CHARS, sort = true } = {}) {
  const items = sort ? [...entries].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : entries;
  const raw = Buffer.from(JSON.stringify(items));
  const version = createHash("sha256").update(raw).digest("hex");
  const encoded = gzipSync(raw).toString("base64"), chunkIds = [];
  for (let offset = 0; offset < encoded.length; offset += chunkSize) {
    const index = chunkIds.length, key = `${version}-${index}`;
    chunkIds.push(key);
    f.documents.set(`${CATALOG_SNAPSHOT_COLLECTION}/${key}`, { schemaVersion: 1, version, index, data: encoded.slice(offset, offset + chunkSize) });
  }
  const manifest = { schemaVersion: 1, version, count: items.length, totalRawBytes: raw.length, encoding: "gzip-base64", chunkIds };
  f.documents.set(`${CATALOG_SNAPSHOT_COLLECTION}/current`, manifest);
  return { manifest, items, chunkPath: `${CATALOG_SNAPSHOT_COLLECTION}/${chunkIds[0]}` };
}

async function allPages(f, kind, extra = {}) {
  const items = [], pages = [];
  let after = extra.after || "";
  for (let count = 0; count < 30; count++) {
    const result = await f.handler(request(kind, { ...extra, after }));
    pages.push(result);
    items.push(...result.items);
    if (!result.nextCursor) return { items, pages };
    assert.notEqual(result.nextCursor, after, "Cursor must make forward progress even after filtering");
    after = result.nextCursor;
  }
  assert.fail("Pagination did not terminate");
}

test("200-document pages retain all 401 terms", async () => {
  const f = fixture();
  for (let i = 0; i < 401; i++) f.documents.set(termPath(`term-${String(i).padStart(4, "0")}`), term());
  const { items, pages } = await allPages(f, "terms");
  assert.equal(items.length, 401);
  assert.equal(new Set(items.map(item => item.sourcePath)).size, 401);
  assert.deepEqual(pages.map(page => page.items.length), [200, 200, 1]);
  assert.ok(f.queries.every(query => query.limit === PAGE_SIZE));
});

test("filtered empty pages still lead to valid canonical records", async () => {
  const f = fixture();
  for (let i = 0; i < 200; i++) f.documents.set(`discarded/bad/history_dictionary_terms/${i}`, term());
  f.documents.set(termPath("last"), term());
  const { items, pages } = await allPages(f, "terms");
  assert.deepEqual(pages.map(page => page.items.length), [0, 1]);
  assert.equal(items[0].sourcePath, termPath("last"));
});

test("exact page multiples terminate after an empty final page", async () => {
  const f = fixture();
  for (let i = 0; i < 200; i++) f.documents.set(wordPath(`term-${String(i).padStart(4, "0")}`), record());
  const { items, pages } = await allPages(f, "words");
  assert.equal(items.length, 200);
  assert.deepEqual(pages.map(page => page.items.length), [200, 0]);
});

test("session rejection precedes every database read", async () => {
  const error = new HttpsError("unauthenticated", "expired-session");
  const f = fixture({ sessionError: error });
  await assert.rejects(f.handler(request()), value => value === error);
  assert.deepEqual(f.events, ["session"]);
  assert.equal(f.queries.length, 0);
});

test("unknown input and malformed or unrelated-collection cursors fail before database reads", async () => {
  const invalid = [
    { unexpected: true }, { uid: "student-other" }, { kind: "requests" },
    { year: "2026/" }, { year: 2026 }, { semester: "3" },
    ...[null, false, 0, {}, [], " ", "../secret", "history_dictionary_terms/..", "history_dictionary_terms/a\\b", "history_dictionary_terms/a\u0001b",
      `history_dictionary_terms/${"a".repeat(1501)}`, "secret/doc", "years/2026/history_dictionary_terms/test/odd",
    ].map(after => ({ after })),
    { kind: "catalog", after: "history_dictionary_terms/term" },
    { catalogMode: "batch" }, { catalogVersion: "a".repeat(64) },
    { kind: "catalog", catalogMode: "all" }, { kind: "catalog", catalogMode: false },
    ...[null, "", "abc", "A".repeat(64), 1, {}].map(catalogVersion => ({ kind: "catalog", catalogMode: "batch", catalogVersion })),
    { kind: "catalog", catalogMode: "batch", catalogVersion: "a".repeat(64), after: `${CATALOG_COLLECTION}/last` },
  ];
  for (const extra of invalid) {
    const f = fixture();
    await assert.rejects(f.handler(request("terms", extra)), code("invalid-argument"), JSON.stringify(extra));
    assert.deepEqual(f.events, ["session"]);
  }
});

test("untrusted identities and profiles cannot query the dictionary", async () => {
  for (const email of ["outsider@example.com", "teacher@yongshin-ms.ms.kr.example.com", ""]) {
    const f = fixture();
    const incoming = request(); incoming.auth.token.email = email;
    await assert.rejects(f.handler(incoming), code("permission-denied"));
    assert.equal(f.reads.length, 0);
  }
  for (const role of ["outsider", "admin", "staff"]) {
    const f = fixture({ role });
    await assert.rejects(f.handler(request()), code("permission-denied"));
    assert.equal(f.queries.length, 0);
  }
  const f = fixture(); f.documents.delete(`users/${uid}`);
  await assert.rejects(f.handler(request()), code("permission-denied"));
});

test("stale pointer, invalid revision, inactive or read-only current manifest reject before query", async () => {
  const variants = [
    ["site_settings/semester_active", null],
    ["site_settings/semester_active", { semesterId: "2027-1", revision: 3 }],
    ["site_settings/semester_active", { semesterId: "2026-2", revision: 0 }],
    ["site_settings/semester_active", { semesterId: "2026-2", revision: "3" }],
    ["semester_manifests/2026-2", null],
    ["semester_manifests/2026-2", { semesterId: "2026-1", revision: 3, status: "ACTIVE" }],
    ["semester_manifests/2026-2", { semesterId: "2026-2", revision: 4, status: "ACTIVE" }],
    ["semester_manifests/2026-2", { semesterId: "2026-2", revision: 3, status: "CLOSED" }],
    ["semester_manifests/2026-2", { semesterId: "2026-2", revision: 3, status: "ACTIVE", readOnly: true }],
  ];
  for (const [path, value] of variants) {
    const f = fixture(); value === null ? f.documents.delete(path) : f.documents.set(path, value);
    await assert.rejects(f.handler(request()), code("failed-precondition"), path);
    assert.equal(f.queries.length, 0);
  }
});

test("own-word query enforces UID and verifies path, stored owner and source scope independently", async () => {
  const f = fixture();
  f.documents.set(wordPath("mine"), record());
  f.documents.set(wordPath("mine-past", uid, past), record(past));
  f.documents.set(wordPath("other", "student-other"), record(current, { uid: "student-other" }));
  f.documents.set(wordPath("spoofed-path", "student-other"), record());
  f.documents.set(wordPath("spoofed-data"), record(current, { uid: "student-other" }));
  f.documents.set(wordPath("wrong-scope"), record(past));
  f.documents.set("unrelated/root/history_dictionary_words/not-a-word", record());
  const result = await f.handler(request("words"));
  assert.deepEqual(result.items.map(item => item.termId).sort(), ["mine", "mine-past"]);
  assert.deepEqual(f.queries[0].filters, [{ field: "uid", operator: "==", value: uid }]);
  assert.equal(result.items.find(item => item.termId === "mine").readOnly, false);
  assert.equal(result.items.find(item => item.termId === "mine-past").readOnly, true);
});

test("cursor location never grants another student's records and malformed owner records do not stop pagination", async () => {
  const f = fixture();
  // These documents pass the server query's UID equality but fail sourceFor's
  // independent path-owner check. A page ending here must remain resumable.
  for (let i = 0; i < 200; i++) f.documents.set(wordPath(`term-${String(i).padStart(4, "0")}`, "a-mismatched-owner"), record());
  f.documents.set(wordPath("mine"), record());
  f.documents.set(wordPath("private", "z-other-student"), record(current, { uid: "z-other-student" }));
  const { items, pages } = await allPages(f, "words");
  assert.deepEqual(pages.map(page => page.items.length), [0, 1]);
  assert.deepEqual(items.map(item => item.termId), ["mine"]);
  assert.ok(f.queries.every(query => query.filters.length === 1 && query.filters[0].value === uid));
  for (const after of [wordPath("last", "a-other-student"), "users/a-other-student/history_dictionary_words/last"]) {
    const resumed = await allPages(f, "words", { after });
    assert.ok(resumed.items.every(item => item.uid === uid));
    assert.ok(!resumed.items.some(item => item.termId === "private"));
  }
});

test("students cannot request the aggregate student word list", async () => {
  const f = fixture();
  await assert.rejects(f.handler(request("studentWords")), code("permission-denied"));
  assert.equal(f.queries.length, 0);
});

test("lesson staff see current saved student words but not historical personal data", async () => {
  const f = fixture({ role: "staff", profile: { teacherPortalEnabled: true, staffPermissions: ["lesson_read"] } });
  f.documents.set(wordPath("current"), record());
  f.documents.set(wordPath("past", uid, past), record(past));
  f.documents.set(wordPath("pending"), record(current, { status: "requested" }));
  const result = await f.handler(request("studentWords"));
  assert.deepEqual(result.items.map(item => item.termId), ["current"]);
  assert.ok(!f.reads.includes("semester_manifests/2026-1"));
  await assert.rejects(f.handler(request("words")), code("permission-denied"));
});

test("teacher and administrator may read archived saved words for all students", async () => {
  for (const administrator of [false, true]) {
    const f = fixture({ role: administrator ? "outsider" : "teacher" });
    f.documents.set(wordPath("current"), record());
    f.documents.set(wordPath("past", "student-other", past), record(past, { uid: "student-other" }));
    const incoming = request("studentWords");
    if (administrator) { incoming.auth.token.email = "westoria28@gmail.com"; f.documents.delete(`users/${uid}`); }
    const result = await f.handler(incoming);
    assert.deepEqual(result.items.map(item => item.termId).sort(), ["current", "past"]);
    assert.ok(result.items.find(item => item.termId === "past").readOnly);
  }
});

test("teacher student-word list excludes copied definitions while own saved words preserve every definition source", async () => {
  const sources = ["student", "teacher_reviewed", "teacher", "", undefined, "catalog"];
  for (const kind of ["studentWords", "words"]) {
    const f = fixture({ role: kind === "studentWords" ? "teacher" : "student" });
    for (const source of [current, past]) {
      for (const [index, definitionSource] of sources.entries()) {
        const data = record(source, { definitionSource });
        if (definitionSource === undefined) delete data.definitionSource;
        f.documents.set(wordPath(`${source.semester}-${index}`, uid, source), data);
      }
    }
    const { items } = await allPages(f, kind);
    if (kind === "studentWords") {
      assert.deepEqual(items.map(item => item.termId).sort(), ["1-0", "1-1", "2-0", "2-1"]);
      assert.ok(items.every(item => ["student", "teacher_reviewed"].includes(item.definitionSource)));
    } else {
      assert.equal(items.length, 12);
      assert.equal(items.filter(item => item.definitionSource === "teacher").length, 2);
      assert.equal(items.filter(item => item.readOnly).length, 6);
    }
  }
});

test("historical terms require a matching CLOSED or ARCHIVED manifest and never a future scope", async () => {
  for (const state of ["CLOSED", "ARCHIVED", "PREPARING", "READY", "ACTIVE", "CLOSING", "QUARANTINED", "missing", "mismatch"]) {
    const f = fixture();
    f.documents.set(termPath("past", past), term(past));
    if (state === "missing") f.documents.delete("semester_manifests/2026-1");
    else f.documents.set("semester_manifests/2026-1", { semesterId: state === "mismatch" ? "2025-1" : "2026-1", status: state === "mismatch" ? "CLOSED" : state });
    const result = await f.handler(request());
    assert.equal(result.items.length, ["CLOSED", "ARCHIVED"].includes(state) ? 1 : 0, state);
  }
  const f = fixture();
  const future = { year: "2027", semester: "1" };
  f.documents.set(termPath("future", future), term(future));
  f.documents.set("semester_manifests/2027-1", { semesterId: "2027-1", status: "ARCHIVED" });
  assert.equal((await f.handler(request())).items.length, 0);
});

test("term publication visibility respects student, lesson staff, teacher and historical boundaries", async () => {
  for (const role of ["student", "staff", "teacher"]) {
    const f = fixture({ role, profile: role === "staff" ? { teacherPortalEnabled: true, staffPermissions: ["lesson_read"] } : {} });
    f.documents.set(termPath("current-published"), term());
    f.documents.set(termPath("current-draft"), term(current, { status: "draft" }));
    f.documents.set(termPath("past-published", past), term(past));
    f.documents.set(termPath("past-draft", past), term(past, { status: "draft" }));
    const ids = (await f.handler(request())).items.map(item => item.id).sort();
    assert.deepEqual(ids, role === "teacher" ? ["current-draft", "current-published", "past-draft", "past-published"]
      : role === "staff" ? ["current-draft", "current-published", "past-published"] : ["current-published", "past-published"]);
  }
});

test("only current own requested words are visible; historical requests stay out of the saved-word archive", async () => {
  const f = fixture();
  f.documents.set(wordPath("current-request"), record(current, { status: "requested" }));
  f.documents.set(wordPath("past-request", uid, past), record(past, { status: "requested" }));
  f.documents.set(wordPath("rejected"), record(current, { status: "rejected" }));
  assert.deepEqual((await f.handler(request("words"))).items.map(item => item.termId), ["current-request"]);
});

test("legacy records require an explicit authorized historical scope and remain read-only", async () => {
  const f = fixture();
  f.documents.set("history_dictionary_terms/scoped", term(past));
  f.documents.set("history_dictionary_terms/missing-scope", { word: "미확인", status: "published" });
  f.documents.set("history_dictionary_terms/current-legacy", term());
  f.documents.set(`users/${uid}/history_dictionary_words/scoped`, record(past));
  f.documents.set(`users/${uid}/history_dictionary_words/spoofed`, record(past, { uid: "someone-else" }));
  const terms = (await f.handler(request())).items;
  assert.deepEqual(terms.map(item => item.id), ["scoped"]);
  assert.equal(terms[0].readOnly, true);
  const words = (await f.handler(request("words"))).items;
  assert.deepEqual(words.map(item => item.termId), ["scoped"]);
  assert.equal(words[0].readOnly, true);
});

test("responses retain source and version metadata but omit private and internal fields", async () => {
  const f = fixture();
  const hidden = { email: "private@example.test", phone: "010-private", secret: "hidden", rewardOrigins: [{ private: true }], wisRewardOrigins: [{ private: true }], ledger: { secret: true } };
  f.documents.set(termPath("public", past), term(past, { ...hidden, studentName: "private", memo: "private", requestedBy: uid, approvedBy: "teacher", relatedUnitId: "unit-1" }));
  f.documents.set(wordPath("own", uid, past), record(past, { ...hidden, definitionSource: "teacher", studentName: "학생", memo: "내 메모", rewardAmount: 1, rewardTransactionId: "txn-1" }));
  const published = (await f.handler(request())).items[0];
  for (const key of [...Object.keys(hidden), "studentName", "memo", "uid", "requestedBy", "approvedBy"]) assert.ok(!(key in published), key);
  assert.equal(published.writeVersion, "100:5");
  assert.equal(published.sourcePath, termPath("public", past));
  assert.equal(published.sourceYear, "2026");
  assert.equal(published.sourceSemester, "1");
  assert.equal(published.updatedAtMs, 100000);
  const personal = (await f.handler(request("words"))).items[0];
  for (const key of Object.keys(hidden)) assert.ok(!(key in personal), key);
  assert.equal(personal.memo, "내 메모");
  assert.equal(personal.definitionSource, "teacher");
  assert.equal(personal.rewardTransactionId, "txn-1");
});

test("query and snapshot failures surface instead of silently returning an empty dictionary", async () => {
  const error = Object.assign(new Error("query-failed"), { code: "unavailable" });
  for (const kind of ["terms", "words", "catalog"]) {
    const f = fixture({ queryError: error, snapshotReadError: error });
    await assert.rejects(f.handler(request(kind)), value => value === error);
  }
});

test("missing snapshots fail explicitly without falling back to original catalog documents", async () => {
  const f = fixture();
  f.documents.set(`${CATALOG_COLLECTION}/original`, { schemaVersion: 1, managedBy: "westory-history-dictionary-catalog", ...catalogRecord("original") });
  await assert.rejects(f.handler(request("catalog")), code("unavailable"));
  await assert.rejects(f.handler(batchRequest()), code("unavailable"));
  assert.equal(f.queries.length, 0);
  assert.ok(!f.reads.some(path => path.startsWith(`${CATALOG_COLLECTION}/`)));
  publishSnapshot(f, [catalogRecord("catalog-history-first")]);
  assert.deepEqual(await f.handler(request("catalog", { after: `${CATALOG_COLLECTION}/catalog-history-last` })), { items: [], nextCursor: "" });
});

test("legacy pagination and one batch preserve the complete source using only snapshot documents", async () => {
  const { loadCatalogSource } = await import("../../scripts/sync-history-dictionary-catalog.mjs");
  const { prepareCatalogSnapshot } = await import("../../scripts/history-dictionary-catalog-snapshot.mjs");
  const { terms } = await loadCatalogSource();
  const f = fixture();
  const prepared = prepareCatalogSnapshot(terms), { manifest } = prepared;
  f.documents.set(`${CATALOG_SNAPSHOT_COLLECTION}/current`, manifest);
  for (const chunk of prepared.chunks) f.documents.set(`${CATALOG_SNAPSHOT_COLLECTION}/${chunk.id}`, chunk.document);
  const { items, pages } = await allPages(f, "catalog");
  assert.equal(items.length, terms.length);
  assert.deepEqual(pages.map(page => page.items.length), [...Array(Math.floor(terms.length / 500)).fill(500), terms.length % 500]);
  assert.equal(f.queries.length, 0);
  assert.equal(f.reads.filter(path => path.startsWith(`${CATALOG_SNAPSHOT_COLLECTION}/`) && !path.endsWith("/current")).length, manifest.chunkIds.length);
  const expected = new Map(terms.map(entry => [entry.id, entry]));
  assert.equal(new Set(items.map(entry => entry.id)).size, terms.length);
  for (const entry of items) assert.deepEqual(entry, expected.get(entry.id), `${entry.id}: preserve every alias, tag, facet and attribution`);
  const cold = fixture();
  publishSnapshot(cold, terms);
  const batch = await cold.handler(batchRequest());
  assert.deepEqual(batch.items, items);
  assert.equal(batch.nextCursor, "");
  assert.equal(batch.version, manifest.version);
  assert.equal(cold.events.filter(event => event === "session").length, 1);
  assert.equal(cold.queries.length, 0);
  assert.equal(cold.reads.filter(path => path.startsWith(`${CATALOG_SNAPSHOT_COLLECTION}/`)).length, 1 + manifest.chunkIds.length);
  const beforeWarm = cold.reads.length;
  await cold.handler(batchRequest());
  const warmReads = cold.reads.slice(beforeWarm).filter(path => path.startsWith(`${CATALOG_SNAPSHOT_COLLECTION}/`));
  assert.deepEqual(warmReads, [`${CATALOG_SNAPSHOT_COLLECTION}/current`]);
  const beforeConditional = cold.reads.length;
  assert.equal((await cold.handler(batchRequest({ catalogVersion: manifest.version }))).notModified, true);
  const conditionalReads = cold.reads.slice(beforeConditional).filter(path => path.startsWith(`${CATALOG_SNAPSHOT_COLLECTION}/`));
  assert.deepEqual(conditionalReads, [`${CATALOG_SNAPSHOT_COLLECTION}/current`]);
  console.log(JSON.stringify({ suite: "dictionary-catalog-read-cost", items: terms.length,
    rawBytes: manifest.totalRawBytes, chunks: manifest.chunkIds.length,
    coldDictionaryDocumentReads: 1 + manifest.chunkIds.length, warmDictionaryDocumentReads: warmReads.length,
    conditionalDictionaryDocumentReads: conditionalReads.length, originalCatalogQueries: cold.queries.length,
    originalCatalogDocumentReads: cold.reads.filter(path => path.startsWith(`${CATALOG_COLLECTION}/`)).length }));
  const sample = terms[0];
  for (const malformed of [
    { id: "bad/id" }, { kind: "unsupported" },
    { word: "" }, { definition: "" }, { aliases: {} }, { facetIds: null }, { attributions: "missing" },
  ]) {
    const bad = fixture();
    publishSnapshot(bad, [{ ...sample, ...malformed }]);
    await assert.rejects(bad.handler(request("catalog")), code("data-loss"), JSON.stringify(malformed));
  }
});

test("matching catalog versions read only the manifest even on a cold instance", async () => {
  const f = fixture();
  const { manifest, chunkPath } = publishSnapshot(f, [catalogRecord("a")]);
  f.documents.delete(chunkPath); // Version validation must not read or decompress chunks.
  assert.deepEqual(await f.handler(batchRequest({ catalogVersion: manifest.version })), {
    items: [], nextCursor: "", version: manifest.version, notModified: true,
  });
  assert.deepEqual(f.reads, [`users/${uid}`, "site_settings/semester_active", "semester_manifests/2026-2", `${CATALOG_SNAPSHOT_COLLECTION}/current`]);
  assert.equal(f.queries.length, 0);
});

test("catalog cache and conditional validation never bypass session, profile or semester checks", async () => {
  for (const failure of ["session", "profile", "pointer", "manifest"]) {
    const f = fixture();
    const { manifest } = publishSnapshot(f, [catalogRecord("a")]);
    await f.handler(batchRequest());
    const readsBefore = f.reads.length;
    if (failure === "session") f.controls.sessionError = new HttpsError("unauthenticated", "expired");
    if (failure === "profile") f.documents.set(`users/${uid}`, { role: "outsider" });
    if (failure === "pointer") f.documents.set("site_settings/semester_active", { semesterId: "2027-1", revision: 3 });
    if (failure === "manifest") f.documents.set("semester_manifests/2026-2", { semesterId: "2026-2", revision: 3, status: "CLOSED" });
    const expected = failure === "session" ? "unauthenticated" : failure === "profile" ? "permission-denied" : "failed-precondition";
    await assert.rejects(f.handler(batchRequest({ catalogVersion: manifest.version })), code(expected));
    assert.ok(!f.reads.slice(readsBefore).some(path => path.startsWith(`${CATALOG_SNAPSHOT_COLLECTION}/`)));
    if (failure === "session") assert.equal(f.reads.length, readsBefore);
  }
});

test("concurrent catalog reads share chunk decoding but each request authenticates and reads the manifest", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let signal;
  const started = new Promise(resolve => { signal = resolve; });
  const f = fixture({ beforeGetAll: async refs => {
    if (refs.some(ref => ref.path.startsWith(`${CATALOG_SNAPSHOT_COLLECTION}/`) && !ref.path.endsWith("/current"))) { signal(); await gate; }
  } });
  const { manifest } = publishSnapshot(f, [catalogRecord("a")], { chunkSize: 40 });
  const first = f.handler(batchRequest());
  await started;
  const second = f.handler(batchRequest());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.reads.filter(path => path.startsWith(`${CATALOG_SNAPSHOT_COLLECTION}/`) && !path.endsWith("/current")).length, manifest.chunkIds.length,
    "The second request must join the first pending load before either can finish");
  release();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(f.events.filter(event => event === "session").length, 2);
  assert.equal(f.reads.filter(path => path.endsWith("/current")).length, 2);
  assert.equal(f.reads.filter(path => path.startsWith(`${CATALOG_SNAPSHOT_COLLECTION}/`) && !path.endsWith("/current")).length, manifest.chunkIds.length);
});

test("a new manifest version replaces warm data immediately and old versions never validate it", async () => {
  const f = fixture();
  const first = publishSnapshot(f, [catalogRecord("a")]);
  await f.handler(batchRequest());
  const second = publishSnapshot(f, [catalogRecord("a", { definition: "바뀐 뜻" }), catalogRecord("b")]);
  const changed = await f.handler(batchRequest({ catalogVersion: first.manifest.version }));
  assert.deepEqual(changed.items, second.items);
  assert.equal(changed.version, second.manifest.version);
  assert.equal(changed.notModified, undefined);
  const readCount = f.reads.length;
  await f.handler(batchRequest());
  assert.equal(f.reads.length - readCount, 4, "Warm reads still read authorization documents plus current manifest");
});

test("failed snapshot loads are retried and never poison the version cache", async () => {
  const f = fixture();
  const { chunkPath } = publishSnapshot(f, [catalogRecord("a")]);
  const valid = f.documents.get(chunkPath);
  f.documents.set(chunkPath, { ...valid, data: "not-base64!" });
  await assert.rejects(f.handler(batchRequest()), code("data-loss"));
  f.documents.set(chunkPath, valid);
  assert.equal((await f.handler(batchRequest())).items.length, 1);
  assert.equal(f.reads.filter(path => path === chunkPath).length, 2);
  assert.equal(f.queries.length, 0);
});

test("snapshot schema, bounds, identity, encoding, hash, byte count and sorted unique IDs are enforced", async () => {
  const mutations = [
    (f, s) => { s.manifest.schemaVersion = 2; },
    (f, s) => { s.manifest.encoding = "json"; },
    (f, s) => { s.manifest.count = CATALOG_SNAPSHOT_MAX_ITEMS + 1; },
    (f, s) => { s.manifest.count++; },
    (f, s) => { s.manifest.totalRawBytes = CATALOG_SNAPSHOT_MAX_BYTES + 1; },
    (f, s) => { s.manifest.totalRawBytes++; },
    (f, s) => { s.manifest.chunkIds = Array(CATALOG_SNAPSHOT_MAX_CHUNKS + 1).fill(s.manifest.chunkIds[0]); },
    (f, s) => { s.manifest.chunkIds = ["unrelated-document"]; },
    (f, s) => { f.documents.delete(s.chunkPath); },
    (f, s) => { f.documents.get(s.chunkPath).schemaVersion = 2; },
    (f, s) => { f.documents.get(s.chunkPath).version = "a".repeat(64); },
    (f, s) => { f.documents.get(s.chunkPath).index = 1; },
    (f, s) => { f.documents.get(s.chunkPath).data = "a".repeat(CATALOG_CHUNK_MAX_CHARS + 1); },
    (f, s) => { f.documents.get(s.chunkPath).data = Buffer.from("not-gzip").toString("base64"); },
    (f, s) => { f.documents.get(s.chunkPath).data = gzipSync(Buffer.from("[]")).toString("base64"); },
    (f, s) => { f.documents.get(s.chunkPath).data = gzipSync(Buffer.alloc(CATALOG_SNAPSHOT_MAX_BYTES + 1, 97)).toString("base64"); },
  ];
  for (const mutate of mutations) {
    const f = fixture(); const snapshot = publishSnapshot(f, [catalogRecord("a")]);
    mutate(f, snapshot);
    await assert.rejects(f.handler(batchRequest()), code("data-loss"));
    assert.equal(f.queries.length, 0);
  }
  for (const rows of [[catalogRecord("a"), catalogRecord("a")], [catalogRecord("b"), catalogRecord("a")]]) {
    const f = fixture(); publishSnapshot(f, rows, { sort: false });
    await assert.rejects(f.handler(batchRequest()), code("data-loss"));
  }
});

test("large snapshots page by count with one generation version and can be revalidated without chunks", async () => {
  const f = fixture();
  const entries = Array.from({ length: CATALOG_BATCH_SIZE + 1 }, (_, i) => catalogRecord(`entry-${String(i).padStart(5, "0")}`));
  const { manifest } = publishSnapshot(f, entries);
  const first = await f.handler(batchRequest());
  assert.equal(first.items.length, CATALOG_BATCH_SIZE);
  assert.equal(first.version, manifest.version);
  assert.equal(first.notModified, undefined);
  const next = await f.handler(batchRequest({ after: first.nextCursor }));
  assert.deepEqual(next.items, entries.slice(CATALOG_BATCH_SIZE));
  assert.equal(next.nextCursor, "");
  assert.equal(next.version, manifest.version);
  const readCount = f.reads.length;
  assert.equal((await f.handler(batchRequest({ catalogVersion: manifest.version }))).notModified, true);
  assert.equal(f.reads.length - readCount, 4);
});

test("batch byte limits retain every record with the same complete-snapshot version", async () => {
  const f = fixture();
  const entries = Array.from({ length: 12 }, (_, i) => catalogRecord(`entry-${String(i).padStart(2, "0")}`, { definition: "a".repeat(800000) }));
  const { manifest } = publishSnapshot(f, entries);
  const first = await f.handler(batchRequest());
  assert.ok(first.items.length > 0 && first.items.length < entries.length);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < CATALOG_BATCH_BYTES);
  assert.equal(first.version, manifest.version);
  assert.equal(first.notModified, undefined);
  const second = await f.handler(batchRequest({ after: first.nextCursor }));
  assert.deepEqual([...first.items, ...second.items], entries);
  assert.equal(second.nextCursor, "");
  assert.equal(second.version, manifest.version);
  assert.equal((await f.handler(batchRequest({ catalogVersion: manifest.version }))).notModified, true);
});

test("personal and teacher records are read afresh even after the catalog is cached", async () => {
  for (const kind of ["terms", "words", "studentWords"]) {
    const f = fixture({ role: kind === "studentWords" ? "teacher" : "student" });
    publishSnapshot(f, [catalogRecord("a")]);
    await f.handler(batchRequest());
    const path = kind === "terms" ? termPath("one") : wordPath("one");
    f.documents.set(path, kind === "terms" ? term() : record());
    assert.equal((await f.handler(request(kind))).items[0].definition, "법과 행정 규정");
    f.documents.set(path, { ...f.documents.get(path), definition: "수정된 뜻" });
    assert.equal((await f.handler(request(kind))).items[0].definition, "수정된 뜻");
    assert.equal(f.queries.length, 2);
  }
});

(async () => {
  const failures = [];
  for (const { name, run } of tests) {
    try { await run(); }
    catch (error) { error.message = `${name}: ${error.message}`; failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, `${failures.length}/${tests.length} continuity regression groups failed`);
  console.log(`History dictionary continuity: ${tests.length} regression groups passed (snapshot-only catalog, cold/warm/conditional reads, bounded batches, 200/500 pagination, session, authorization, privacy).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
