import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Exercise the production pager with controlled, synthetic transport promises.
// These checks never import Firebase or connect to a browser or production data.
const source = await fs.readFile(
  fileURLToPath(
    new URL(
      "../src/pages/teacher/components/quizQuestionPaging.ts",
      import.meta.url,
    ),
  ),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  createQuizQuestionPager,
  quizQuestionCatalogEntry,
  quizPageNumbers,
  QUIZ_QUESTION_PAGE_SIZE,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const checks = [];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const questions = Array.from({ length: 95 }, (_, index) => ({
  id: 1001 + index,
  unitId: "unit-a",
  subUnitId: index % 3 === 0 ? "leaf-b" : index % 3 === 1 ? "leaf-a" : null,
  category: index < 71 ? "diagnostic" : index < 89 ? "formative" : "exam_prep",
  type: "choice",
  refBig: "big-a",
  refMid: index < 40 ? "mid-a" : "mid-b",
  refSmall: index % 2 ? "small-a" : "small-b",
  question: `문항 ${index + 1}`,
  passage: index === 70 ? "마지막 페이지의 전체 검색표적 PASSAGE" : "자료",
  explanation: index === 88 ? "EXPLANATION 검색표적" : "해설",
  concepts: index === 94 ? ["CONCEPT 검색표적"] : [],
  image: "data:image/png;base64,synthetic-heavy-body",
  options: ["가", "나", "다", "라", "마"],
  answer: "가",
  contentRevision: 1,
}));
const docId = (q) => `document-${q.id}`;
const entries = questions.map((q) => quizQuestionCatalogEntry(q, docId(q)));
const bodyRows = (requested) =>
  requested.map((entry) => ({
    documentId: entry.documentId,
    question: questions.find((q) => q.id === entry.id),
  }));
const ids = (rows) => rows.map((row) => row.id);
const diagnostic = entries.filter((entry) => entry.category === "diagnostic");
async function check(name, action) {
  await action();
  checks.push(name);
}

await check("one metadata request, coalesced concurrent callers", async () => {
  const loading = deferred();
  let reads = 0;
  const pager = createQuizQuestionPager(
    () => {
      reads++;
      return loading.promise;
    },
    async () => [],
  );
  const first = pager.catalog();
  const second = pager.catalog();
  assert.equal(reads, 1);
  loading.resolve([...entries].reverse());
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(ids(a), ids(entries));
  assert.deepEqual(a, b);
  assert.deepEqual(await pager.catalog(), entries);
  assert.equal(reads, 1);
});

await check(
  "20-body first page, direct last page, cached previous page",
  async () => {
    const requests = [];
    const pager = createQuizQuestionPager(
      async () => entries,
      async (batch) => {
        requests.push(batch.map((entry) => entry.documentId));
        return bodyRows(batch).reverse(); // Firestore order is unrelated to catalog order.
      },
    );
    await pager.catalog();
    assert.equal(QUIZ_QUESTION_PAGE_SIZE, 20);
    assert.deepEqual(
      ids(await pager.page(diagnostic.slice(0, 20))),
      ids(questions.slice(0, 20)),
    );
    assert.deepEqual(
      ids(await pager.page(diagnostic.slice(60, 80))),
      ids(questions.slice(60, 71)),
    );
    assert.deepEqual(
      ids(await pager.page(diagnostic.slice(0, 20))),
      ids(questions.slice(0, 20)),
    );
    assert.deepEqual(
      requests.map((request) => request.length),
      [20, 11],
    );
    assert.deepEqual(
      requests.flat(),
      [...diagnostic.slice(0, 20), ...diagnostic.slice(60)].map(
        (entry) => entry.documentId,
      ),
    );
    assert.equal(
      requests
        .flat()
        .some((id) =>
          diagnostic.slice(20, 60).some((entry) => entry.documentId === id),
        ),
      false,
    );
    await assert.rejects(pager.page(diagnostic.slice(0, 21)), /페이지 크기/);
    assert.deepEqual(await pager.page([]), []);
    assert.equal(requests.length, 2);
  },
);

await check(
  "complete search/category/subunit/reference metadata without body scans",
  async () => {
    let bodyReads = 0;
    const pager = createQuizQuestionPager(
      async () => entries,
      async (batch) => {
        bodyReads++;
        return bodyRows(batch);
      },
    );
    const catalog = await pager.catalog();
    assert.equal(
      catalog.filter((entry) => entry.category === "diagnostic").length,
      71,
    );
    assert.equal(
      catalog.filter((entry) => entry.category === "formative").length,
      18,
    );
    assert.equal(
      catalog.filter((entry) => entry.subUnitId === "leaf-b").length,
      32,
    );
    assert.equal(
      catalog.filter((entry) => entry.refMid === "mid-b").length,
      55,
    );
    assert.deepEqual(
      ids(catalog.filter((entry) => entry.searchText.includes("passage"))),
      [1071],
    );
    assert.deepEqual(
      ids(catalog.filter((entry) => entry.searchText.includes("explanation"))),
      [1089],
    );
    assert.deepEqual(
      ids(catalog.filter((entry) => entry.searchText.includes("concept"))),
      [1095],
    );
    assert.equal(bodyReads, 0);
    for (const entry of catalog) {
      for (const field of [
        "image",
        "options",
        "answer",
        "question",
        "passage",
        "explanation",
      ])
        assert.equal(
          Object.hasOwn(entry, field),
          false,
          `${field} must not be returned as a body field`,
        );
    }
  },
);

await check("overlapping requests share pending document reads", async () => {
  const gates = [deferred(), deferred()];
  const requests = [];
  const pager = createQuizQuestionPager(
    async () => entries,
    (batch) => {
      const index = requests.length;
      requests.push(batch);
      return gates[index].promise;
    },
  );
  const first = pager.page(diagnostic.slice(0, 20));
  const same = pager.page(diagnostic.slice(0, 20));
  const overlap = pager.page(diagnostic.slice(10, 30));
  assert.deepEqual(
    requests.map((request) => request.length),
    [20, 10],
  );
  gates[1].resolve(bodyRows(requests[1]).reverse());
  gates[0].resolve(bodyRows(requests[0]).reverse());
  const values = await Promise.all([first, same, overlap]);
  assert.deepEqual(ids(values[0]), ids(questions.slice(0, 20)));
  assert.deepEqual(ids(values[1]), ids(values[0]));
  assert.deepEqual(ids(values[2]), ids(questions.slice(10, 30)));
  assert.equal(
    new Set(requests.flat().map((entry) => entry.documentId)).size,
    30,
  );
});

await check(
  "out-of-order page responses retain requested identity and cache",
  async () => {
    const gates = [deferred(), deferred()];
    const requested = [];
    const pager = createQuizQuestionPager(
      async () => entries,
      (batch) => {
        requested.push(batch);
        return gates[requested.length - 1].promise;
      },
    );
    const first = pager.page(diagnostic.slice(0, 20));
    const last = pager.page(diagnostic.slice(60));
    gates[1].resolve(bodyRows(requested[1]));
    assert.deepEqual(ids(await last), ids(questions.slice(60, 71)));
    gates[0].resolve(bodyRows(requested[0]));
    assert.deepEqual(ids(await first), ids(questions.slice(0, 20)));
    assert.deepEqual(
      ids(await pager.page(diagnostic.slice(60))),
      ids(questions.slice(60, 71)),
    );
    assert.equal(requested.length, 2);
  },
);

await check("failed catalog retries without a rejected cache", async () => {
  let attempts = 0;
  const pager = createQuizQuestionPager(
    async () => {
      if (++attempts === 1) throw new Error("catalog offline");
      return entries;
    },
    async () => [],
  );
  const outcome = await Promise.allSettled([pager.catalog(), pager.catalog()]);
  assert.ok(outcome.every((value) => value.status === "rejected"));
  assert.equal(attempts, 1);
  assert.equal((await pager.catalog()).length, 95);
  assert.equal(attempts, 2);
  await pager.catalog();
  assert.equal(attempts, 2);
});

await check("failed page retries, success remains cached", async () => {
  let attempts = 0;
  const pager = createQuizQuestionPager(
    async () => entries,
    async (batch) => {
      if (++attempts === 1) throw new Error("body offline");
      return bodyRows(batch);
    },
  );
  const outcome = await Promise.allSettled([
    pager.page(diagnostic.slice(0, 20)),
    pager.page(diagnostic.slice(0, 20)),
  ]);
  assert.ok(outcome.every((value) => value.status === "rejected"));
  assert.equal(attempts, 1);
  assert.equal((await pager.page(diagnostic.slice(0, 20))).length, 20);
  await pager.page(diagnostic.slice(0, 20));
  assert.equal(attempts, 2);
});

await check(
  "missing body fails explicitly and retries only the missing document",
  async () => {
    const requested = [];
    const pager = createQuizQuestionPager(
      async () => entries,
      async (batch) => {
        requested.push(batch);
        return bodyRows(requested.length === 1 ? batch.slice(1) : batch);
      },
    );
    await assert.rejects(pager.page(diagnostic.slice(0, 3)), /목록이 변경/);
    assert.deepEqual(
      ids(await pager.page(diagnostic.slice(0, 3))),
      ids(questions.slice(0, 3)),
    );
    assert.deepEqual(
      requested.map((batch) => batch.length),
      [3, 1],
    );
  },
);

await check(
  "save/delete overlays update metadata and cached bodies without refetch",
  async () => {
    let metadataReads = 0,
      bodyReads = 0;
    const pager = createQuizQuestionPager(
      async () => {
        metadataReads++;
        return entries;
      },
      async (batch) => {
        bodyReads++;
        return bodyRows(batch);
      },
    );
    await pager.catalog();
    const saved = {
      ...questions[0],
      question: "저장한 새 내용",
      category: "formative",
      subUnitId: "leaf-b",
      contentRevision: 2,
    };
    const savedEntry = quizQuestionCatalogEntry(saved, docId(saved));
    const added = { ...questions[0], id: 9999, question: "새로 추가한 문항" };
    pager.upsert(savedEntry, saved);
    pager.upsert(quizQuestionCatalogEntry(added, docId(added)), added);
    pager.remove(entries[1].documentId);
    const latest = await pager.catalog();
    assert.equal(latest.length, 95);
    assert.equal(
      latest.find((entry) => entry.id === saved.id).category,
      "formative",
    );
    assert.equal(
      latest.some((entry) => entry.id === questions[1].id),
      false,
    );
    assert.equal(latest.at(-1).id, 9999);
    assert.deepEqual(await pager.page([savedEntry]), [saved]);
    assert.deepEqual([metadataReads, bodyReads], [1, 0]);
  },
);

await check(
  "save/delete during initial metadata loading survive stale response",
  async () => {
    const loading = deferred();
    const pager = createQuizQuestionPager(
      () => loading.promise,
      async () => {
        throw new Error("saved body should be cached");
      },
    );
    const initial = pager.catalog();
    const saved = {
      ...questions[0],
      question: "목록 조회 도중 저장",
      contentRevision: 2,
    };
    const savedEntry = quizQuestionCatalogEntry(saved, docId(saved));
    pager.upsert(savedEntry, saved);
    pager.remove(entries[1].documentId);
    loading.resolve(entries);
    const merged = await initial;
    assert.equal(merged.length, 94);
    assert.equal(
      merged.find((entry) => entry.id === saved.id).contentRevision,
      2,
    );
    assert.equal(
      merged.some((entry) => entry.documentId === entries[1].documentId),
      false,
    );
    assert.deepEqual(await pager.page([savedEntry]), [saved]);
  },
);

await check(
  "late old-revision body cannot replace the saved revision",
  async () => {
    const loading = deferred();
    let bodyReads = 0;
    const pager = createQuizQuestionPager(
      async () => entries,
      () => {
        bodyReads++;
        return loading.promise;
      },
    );
    await pager.catalog();
    const oldRead = pager.page([entries[0]]);
    const saved = {
      ...questions[0],
      question: "저장한 최신 본문",
      contentRevision: 2,
    };
    const savedEntry = quizQuestionCatalogEntry(saved, docId(saved));
    pager.upsert(savedEntry, saved);
    loading.resolve(bodyRows([entries[0]]));
    await oldRead;
    assert.deepEqual(await pager.page([savedEntry]), [saved]);
    assert.equal((await pager.catalog())[0].contentRevision, 2);
    assert.equal(bodyReads, 1);
  },
);

await check(
  "catalog/body revision mismatch fails without automatic refetch",
  async () => {
    let reads = 0;
    const pager = createQuizQuestionPager(
      async () => entries,
      async () => {
        reads++;
        return [
          {
            documentId: entries[0].documentId,
            question: { ...questions[0], contentRevision: 2 },
          },
        ];
      },
    );
    await assert.rejects(pager.page([entries[0]]), /목록이 변경/);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(reads, 1);
    // Explicit user retry may read again, but must not consume a poisoned cache.
    await assert.rejects(pager.page([entries[0]]), /목록이 변경/);
    assert.equal(reads, 2);
  },
);

await check(
  "body question identity must match the catalog document",
  async () => {
    let reads = 0;
    const pager = createQuizQuestionPager(
      async () => entries,
      async () => {
        reads++;
        return [{ documentId: entries[0].documentId, question: questions[1] }];
      },
    );
    await assert.rejects(pager.page([entries[0]]), /목록이 변경/);
    assert.equal(reads, 1);
  },
);

await check(
  "compact page navigation exposes first, current, last without duplicates",
  async () => {
    assert.deepEqual(quizPageNumbers(1, 1), [1]);
    assert.deepEqual(quizPageNumbers(4, 4), [1, 2, 3, 4]);
    assert.deepEqual(quizPageNumbers(5, 10), [1, "gap", 4, 5, 6, "gap", 10]);
    assert.deepEqual(quizPageNumbers(10, 10), [1, "gap", 7, 8, 9, 10]);
  },
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: checks.length,
      pageSize: QUIZ_QUESTION_PAGE_SIZE,
      scenarios: checks,
    },
    null,
    2,
  ),
);
