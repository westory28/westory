import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/lib/historyDictionaryCatalogCache.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const item = {
  id: "core-test",
  word: "사료",
  definition: "역사를 연구하는 데 쓰는 자료.",
  kind: "history",
  aliases: [],
  tags: [],
  facetIds: [],
  attributions: [{ title: "검증용 출처" }],
};
const snapshot = (items) => ({
  items,
  version: createHash("sha256").update(JSON.stringify(items)).digest("hex"),
});
const initial = snapshot([item]);
const disk = { value: undefined, writes: 0 };
function fixture({ failStorage = false } = {}) {
  const api = {};
  const indexedDB = {
    open() {
      if (failStorage) throw Error("storage denied");
      const open = {};
      setImmediate(() => {
        open.result = {
          close() {},
          transaction() {
            const transaction = {
              objectStore: () => ({
                get() {
                  const request = { result: structuredClone(disk.value) };
                  setImmediate(() => transaction.oncomplete());
                  return request;
                },
                put(value) {
                  disk.value = structuredClone(value);
                  disk.writes++;
                  setImmediate(() => transaction.oncomplete());
                  return { result: "current" };
                },
              }),
            };
            return transaction;
          },
        };
        open.onsuccess();
      });
      return open;
    },
  };
  vm.runInNewContext(js, {
    exports: api,
    indexedDB,
    crypto: webcrypto,
    TextEncoder,
    setTimeout,
    clearTimeout,
  });
  return api.loadHistoryDictionaryCatalogSnapshot;
}
const authorized = async () => {};
const tick = () => new Promise((resolve) => setImmediate(resolve));
let checks = 0;
let downloaded = 0;
const server = async (input) => {
  checks++;
  assert.equal(input.catalogMode, "batch");
  if (input.catalogVersion === initial.version)
    return {
      items: [],
      version: initial.version,
      notModified: true,
      nextCursor: "",
    };
  downloaded++;
  return { ...initial, nextCursor: "" };
};
const firstVisit = fixture();
assert.equal((await firstVisit(server, authorized))[0].word, "사료");
await tick();
await tick();
assert.equal(disk.writes, 1);
assert.equal((await firstVisit(server, authorized)).length, 1);
// New JS realm models a full browser reload, with only IndexedDB retained.
assert.equal((await fixture()(server, authorized)).length, 1);
assert.equal(checks, 3, "every visit is authorized and version checked");
assert.equal(downloaded, 1, "repeat visits never download all words again");
assert.equal(disk.writes, 1, "unchanged snapshots are not rewritten");

const revised = snapshot([{ ...item, definition: "수정된 설명" }]);
assert.equal(
  (await fixture()(async () => ({ ...revised, nextCursor: "" }), authorized))[0]
    .definition,
  "수정된 설명",
);
await tick();
await tick();
assert.equal(disk.value.version, revised.version);
await assert.rejects(
  fixture()(async () => {
    throw Error("permission-denied");
  }, authorized),
  /permission-denied/,
  "cached content cannot bypass a denied request",
);
await assert.rejects(
  fixture()(
    async () => ({ items: [], notModified: true, version: initial.version }),
    authorized,
  ),
  /버전/,
);
disk.value.items[0].definition = "손상된 캐시";
await fixture()(async (input) => {
  assert.equal(
    input.catalogVersion,
    undefined,
    "corrupt disk content is never conditionally accepted",
  );
  return { ...initial, nextCursor: "" };
}, authorized);
await tick();
await tick();
assert.equal(
  (await fixture({ failStorage: true })(server, authorized)).length,
  1,
);
disk.value.items[0].cycle = disk.value.items[0];
await fixture()(async (input) => {
  assert.equal(input.catalogVersion, undefined);
  return { ...initial, nextCursor: "" };
}, authorized);
await tick();
await tick();
const large = snapshot(
  Array.from({ length: 5001 }, (_, index) => ({
    ...item,
    id: `entry-${String(index).padStart(5, "0")}`,
  })),
);
let pages = 0;
await fixture()(async (input) => {
  pages++;
  return {
    items: input.after ? large.items.slice(5000) : large.items.slice(0, 5000),
    nextCursor: input.after ? "" : "page-two",
    version: large.version,
  };
}, authorized);
assert.equal(pages, 2);
await tick();
await tick();
assert.equal(
  (
    await fixture()(async (input) => {
      assert.equal(input.catalogVersion, large.version);
      return {
        items: [],
        nextCursor: "",
        notModified: true,
        version: large.version,
      };
    }, authorized)
  ).length,
  5001,
);
await assert.rejects(
  fixture()(
    async (input) => ({
      items: input.after ? large.items.slice(5000) : large.items.slice(0, 5000),
      nextCursor: input.after ? "" : "page-two",
      version: input.after ? initial.version : large.version,
    }),
    authorized,
  ),
  /변경/,
);
let live = true;
await assert.rejects(
  fixture()(
    async () => {
      live = false;
      return { ...initial, nextCursor: "" };
    },
    async () => {
      if (!live) throw Error("account changed");
    },
  ),
  /account changed/,
);
await assert.rejects(
  fixture({ failStorage: true })(
    async () => ({ items: [item], nextCursor: "repeat" }),
    authorized,
  ),
  /중단/,
);
await assert.rejects(
  fixture()(
    async () => ({ ...initial, version: "0".repeat(64), nextCursor: "" }),
    authorized,
  ),
  /버전/,
);
console.log(
  "dictionary cache checks passed: restart persistence, version changes, denied reads, corrupt cache, storage denial, account changes, pagination guards",
);
