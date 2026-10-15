import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const plain = (value) => JSON.parse(JSON.stringify(value));
const current = { year: "2026", semester: "2" };
const scopePath = ({ year, semester }) =>
  `years/${year}/semesters/${semester}/map_resources`;
const row = (id, title, sortOrder) => ({
  id,
  data: {
    title,
    category: "지도",
    type: "image",
    ...(sortOrder === undefined ? {} : { sortOrder }),
  },
});

function fixture() {
  const auth = { currentUser: { uid: "student-a" } };
  const clock = { now: 1800000000000 };
  class ClockDate extends Date {
    static now() {
      return clock.now;
    }
  }
  const collections = new Map();
  const reads = [];
  const controls = { beforeRead: async () => {} };
  const firestore = {
    collection: (_db, path) => ({ path, constraints: [] }),
    query: (reference, ...constraints) => ({ ...reference, constraints }),
    orderBy: (field) => ({ kind: "orderBy", field }),
    getDocs: async ({ path, constraints = [] }) => {
      reads.push(path);
      await controls.beforeRead(path);
      let rows = collections.get(path) || [];
      // Firestore orderBy excludes documents missing the ordered field. Model
      // that behavior so the no-sortOrder fixture catches a query regression.
      for (const constraint of constraints)
        if (constraint.kind === "orderBy")
          rows = rows.filter((item) =>
            Object.hasOwn(item.data, constraint.field),
          );
      return {
        docs: rows.map((item) => ({
          id: item.id,
          data: () => plain(item.data),
        })),
      };
    },
    getDoc: () => {
      throw new Error("Map reads must not read individual lessons");
    },
    doc: () => {
      throw new Error("Unexpected document lookup");
    },
  };
  const modules = new Map();
  const load = (filename) => {
    const file = resolve(filename);
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    modules.set(file, exports);
    const source = readFileSync(file, "utf8").replaceAll(
      "import.meta.env",
      "({})",
    );
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    vm.runInNewContext(
      output,
      {
        exports,
        Date: ClockDate,
        require(name) {
          if (name === "firebase/firestore") return firestore;
          if (name === "./firebase") return { auth, db: {} };
          if (name === "./semesterArchive")
            return { archiveScope: null, isSemesterArchive: false };
          if (name === "./historyDictionarySession")
            return {
              getHistoryDictionaryCallable: () => {
                throw new Error("No callable/network use in map fixture");
              },
            };
          assert(name.startsWith("."), `Unexpected dependency ${name}`);
          return load(resolve(dirname(file), `${name}.ts`));
        },
      },
      { filename: file },
    );
    return exports;
  };
  return {
    auth,
    clock,
    collections,
    reads,
    controls,
    read: load("src/lib/studentLessonReadCache.ts").readStudentMapResources,
  };
}

let checks = 0;
{
  const f = fixture();
  f.collections.set("map_resources", [
    row("legacy", "이전 지도", 5),
    row("no-order", "순서 없는 지도"),
  ]);
  const first = await f.read(current);
  assert.deepEqual(plain(first.map((item) => item.id)), [
    "google-maps",
    "legacy",
    "no-order",
  ]);
  assert.equal(first.find((item) => item.id === "no-order").sortOrder, 999);
  assert.deepEqual(
    f.reads.sort(),
    ["map_resources", scopePath(current)].sort(),
  );
  checks++;

  f.collections.set(scopePath(current), [row("new", "첫 학기 지도", 1)]);
  assert.strictEqual(await f.read(current), first);
  assert.equal(f.reads.length, 2);
  checks++;

  f.clock.now += 60001;
  const refreshed = await f.read(current);
  assert.deepEqual(plain(refreshed.map((item) => item.id)), [
    "google-maps",
    "new",
    "legacy",
    "no-order",
  ]);
  assert.equal(f.reads.length, 4);
  checks++;
}
{
  const f = fixture();
  f.collections.set("map_resources", [
    row("shared", "이전 이름", 1),
    row("legacy-only", "보존", 2),
    row("google-maps", "기존 Google", 0),
  ]);
  f.collections.set(scopePath(current), [
    row("shared", "현재 학기 이름", 8),
    row("google-maps", "현재 Google", 0),
    row("unordered", "현재 순서 없음"),
  ]);
  const maps = await f.read(current);
  assert.equal(
    maps.find((item) => item.id === "shared").title,
    "현재 학기 이름",
  );
  assert.equal(maps.filter((item) => item.id === "shared").length, 1);
  assert.equal(
    maps.find((item) => item.id === "google-maps").title,
    "현재 Google",
  );
  assert.equal(maps.filter((item) => item.id === "google-maps").length, 1);
  assert(maps.some((item) => item.id === "legacy-only"));
  assert(maps.some((item) => item.id === "unordered"));
  checks++;
}
{
  const f = fixture();
  const ownerA = f.auth.currentUser;
  f.collections.set(scopePath(current), [row("scope", "A 사용자 조회", 1)]);
  const a = await f.read(current);
  f.auth.currentUser = { uid: "student-b" };
  f.collections.set(scopePath(current), [row("scope", "B 사용자 조회", 1)]);
  const b = await f.read(current);
  assert.equal(b.find((item) => item.id === "scope").title, "B 사용자 조회");
  assert.notStrictEqual(a, b);
  assert.equal(f.reads.length, 4);
  f.auth.currentUser = ownerA;
  assert.strictEqual(await f.read(current), a);
  assert.equal(f.reads.length, 4);
  checks++;

  const otherSemester = { year: "2026", semester: "1" };
  const otherYear = { year: "2027", semester: "2" };
  f.collections.set(scopePath(otherSemester), [row("scope", "다른 학기", 1)]);
  f.collections.set(scopePath(otherYear), [row("scope", "다른 연도", 1)]);
  assert.equal(
    (await f.read(otherSemester)).find((item) => item.id === "scope").title,
    "다른 학기",
  );
  assert.equal(
    (await f.read(otherYear)).find((item) => item.id === "scope").title,
    "다른 연도",
  );
  assert.equal(f.reads.length, 8);
  checks++;
}
{
  const f = fixture();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  f.controls.beforeRead = () => pending;
  const first = f.read(current);
  const second = f.read(current);
  assert.strictEqual(first, second);
  assert.equal(f.reads.length, 2);
  release();
  assert.strictEqual(await first, await second);
  checks++;
}
{
  const f = fixture();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  f.controls.beforeRead = () => pending;
  const previousOwner = f.auth.currentUser;
  const first = f.read(current);
  f.auth.currentUser = { uid: "student-b" };
  release();
  await assert.rejects(first, /로그인 계정/);
  f.controls.beforeRead = async () => {};
  f.auth.currentUser = previousOwner;
  await f.read(current);
  assert.equal(f.reads.length, 4);
  checks++;
}
{
  const f = fixture();
  f.controls.beforeRead = async () => {
    throw new Error("fixture read failed");
  };
  await assert.rejects(f.read(current), /fixture read failed/);
  f.controls.beforeRead = async () => {};
  f.collections.set("map_resources", [row("retry", "재조회", 1)]);
  assert((await f.read(current)).some((item) => item.id === "retry"));
  assert.equal(f.reads.length, 4);
  checks++;
}
console.log(
  `PASS student map resources: ${checks} merge, missing-order, UID/semester/year isolation, TTL, in-flight and failure recovery checks; network 0`,
);
