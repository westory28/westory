const assert = require("node:assert/strict");
const { HttpsError } = require("firebase-functions/v2/https");
const { FieldPath } = require("firebase-admin/firestore");
const {
  createHistoryDictionaryContinuityHandler, CATALOG_COLLECTION, PAGE_SIZE, CATALOG_PAGE_SIZE,
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
const request = (kind = "terms", extra = {}) => ({
  auth: { uid, token: { email: `${uid}@yongshin-ms.ms.kr` } },
  data: { ...current, kind, _session: { sessionId: "test-session", sessionVersion: 1 }, ...extra },
});
const code = expected => error => error.code === expected;
const tests = [];
const test = (name, run) => tests.push({ name, run });

function fixture({ role = "student", profile = {}, sessionError, queryError } = {}) {
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
        if (queryError) throw queryError;
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
    async getAll(...refs) { events.push("getAll"); reads.push(...refs.map(ref => ref.path)); return refs.map(ref => snapshot(ref.path)); },
    collection: name => buildQuery(name, false),
    collectionGroup: name => buildQuery(name, true),
  };
  const handler = createHistoryDictionaryContinuityHandler({
    db,
    assertSession: async incoming => {
      events.push("session");
      assert.equal(incoming.data._session.sessionId, "test-session");
      if (sessionError) throw sessionError;
    },
  });
  return { documents, events, queries, reads, handler };
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

test("query failures surface instead of silently returning an empty dictionary", async () => {
  const error = Object.assign(new Error("query-failed"), { code: "unavailable" });
  for (const kind of ["terms", "words", "catalog"]) {
    const f = fixture({ queryError: error });
    await assert.rejects(f.handler(request(kind)), value => value === error);
  }
});

test("empty catalog fails explicitly while an empty final page is allowed", async () => {
  const f = fixture();
  await assert.rejects(f.handler(request("catalog")), code("unavailable"));
  assert.deepEqual(await f.handler(request("catalog", { after: `${CATALOG_COLLECTION}/catalog-history-last` })), { items: [], nextCursor: "" });
});

test("catalog pagination preserves all 2,373 complete source records across 500-document pages", async () => {
  const { loadCatalogSource, catalogDocumentFor } = await import("../../scripts/sync-history-dictionary-catalog.mjs");
  const { terms } = await loadCatalogSource();
  const f = fixture();
  for (const entry of terms) f.documents.set(`${CATALOG_COLLECTION}/${entry.id}`, { ...catalogDocumentFor(entry), updatedAt: stamp });
  const { items, pages } = await allPages(f, "catalog");
  assert.equal(items.length, 2373);
  assert.deepEqual(pages.map(page => page.items.length), [500, 500, 500, 500, 373]);
  assert.ok(f.queries.every(query => query.limit === CATALOG_PAGE_SIZE && !query.group));
  const expected = new Map(terms.map(entry => [entry.id, entry]));
  assert.equal(new Set(items.map(entry => entry.id)).size, 2373);
  for (const entry of items) assert.deepEqual(entry, expected.get(entry.id), `${entry.id}: preserve every alias, tag, facet and attribution`);
  const sample = terms[0];
  for (const malformed of [
    { schemaVersion: 2 }, { managedBy: "untrusted" }, { id: "different-id" }, { kind: "unsupported" },
    { word: "" }, { definition: "" }, { aliases: {} }, { facetIds: null }, { attributions: "missing" },
  ]) {
    const bad = fixture();
    bad.documents.set(`${CATALOG_COLLECTION}/${sample.id}`, { ...catalogDocumentFor(sample), ...malformed });
    await assert.rejects(bad.handler(request("catalog")), code("data-loss"), JSON.stringify(malformed));
  }
});

(async () => {
  const failures = [];
  for (const { name, run } of tests) {
    try { await run(); }
    catch (error) { error.message = `${name}: ${error.message}`; failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, `${failures.length}/${tests.length} continuity regression groups failed`);
  console.log(`History dictionary continuity: ${tests.length} regression groups passed (200/500 pagination, session, authorization, privacy, complete catalog).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
