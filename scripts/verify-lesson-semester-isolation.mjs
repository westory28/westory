import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const state = { docs: new Map(), reads: [] };
globalThis.__lessonSemesterFixture = state;
const compiled = await build({
  entryPoints: ["src/lib/studentLessonReadCache.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  define: { "import.meta.env": "{}" },
  plugins: [{
    name: "isolated-firestore",
    setup(builder) {
      builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: "firestore", namespace: "fixture" }));
      builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: "firebase", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
        contents: path === "firebase" ? "export const db = {};" : `
          const state = globalThis.__lessonSemesterFixture;
          export const collection = (_db, ...path) => ({ path: path.join('/') });
          export const doc = collection;
          export const where = (field, op, value) => ({ field, op, value });
          export const orderBy = () => ({});
          export const query = (ref, ...filters) => ({ ...ref, filters });
          export async function getDoc(ref) {
            state.reads.push(ref.path);
            return { exists: () => state.docs.has(ref.path), data: () => state.docs.get(ref.path) };
          }
          export async function getDocs(ref) {
            state.reads.push(ref.path);
            const rows = [...state.docs].filter(([path, data]) =>
              path.startsWith(ref.path + '/') && path.slice(ref.path.length + 1).indexOf('/') < 0 &&
              (ref.filters || []).every(f => !f.field || data[f.field] === f.value));
            const docs = rows.map(([path, data]) => ({ id: path.split('/').at(-1), data: () => data }));
            return { docs, empty: docs.length === 0 };
          }
        `,
      }));
    },
  }],
});
const reader = await import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].contents).toString("base64"));
const first = "years/2026/semesters/1";
const second = "years/2026/semesters/2";
const tree = [{ id: "same-unit", title: "1학기 자료" }];
state.docs.set("curriculum/tree", { tree });
state.docs.set("lessons/global-only", { unitId: "global-only", title: "전역 자료", isVisibleToStudents: true });
state.docs.set(`${first}/curriculum/tree`, { tree });
state.docs.set(`${first}/lessons/old`, { unitId: "same-unit", title: "1학기 자료", isVisibleToStudents: true });
const config1 = { year: "2026", semester: "1" };
const config2 = { year: "2026", semester: "2" };

assert.throws(() => reader.readStudentVisibleLessons(null), /학기/);
assert.throws(() => reader.readStudentLesson({ year: "2026" }, "same-unit"), /학기/);
assert.equal(state.reads.length, 0, "unresolved scope must not query a default semester");
assert.deepEqual(await reader.readStudentVisibleLessons(config2), []);
assert.deepEqual(await reader.readStudentVisibleCurriculumTree(config2), []);
assert.equal(await reader.readStudentLesson(config2, "same-unit"), null);
assert.equal(await reader.readStudentLesson(config2, "global-only"), null);
assert.equal(await reader.readStudentLatestLessonSelection(config2, tree), null);
assert.ok(state.reads.every(path => path.startsWith(second + "/")), "empty current semester must never read global or prior-semester material");

assert.equal((await reader.readStudentLesson(config1, "same-unit")).title, "1학기 자료");
assert.deepEqual(await reader.readStudentVisibleCurriculumTree(config1), tree);
assert.equal((await reader.readStudentVisibleLessons(config1)).length, 1);
assert.equal(await reader.readStudentLesson(config2, "same-unit"), null, "archive cache cannot populate current semester");

// A newly authored current-semester unit must have its own data despite a matching old unit ID.
state.docs.set(`${first}/lessons/shared`, { unitId: "new-unit", title: "과거 내용" });
state.docs.set(`${second}/lessons/shared`, { unitId: "new-unit", title: "현재 내용" });
assert.equal((await reader.readStudentLesson(config1, "new-unit")).title, "과거 내용");
assert.equal((await reader.readStudentLesson(config2, "new-unit")).title, "현재 내용");

const teacher = readFileSync("src/pages/teacher/ManageLesson.tsx", "utf8");
assert.doesNotMatch(teacher, /collection\(db,\s*"lessons"\)|doc\(db,\s*"curriculum",\s*"tree"\)/);
assert.match(teacher, /collectionPaths:\s*\[getSemesterCollectionPath\(config, "lessons"\)\]/);
const preview = readFileSync("src/pages/teacher/components/ArchivedLessonPreview.tsx", "utf8");
assert.match(preview, /lessonOverride=\{snapshot\}/);
assert.match(preview, /disablePersistence/);
assert.match(preview, /allowHiddenAccess/);
delete globalThis.__lessonSemesterFixture;
console.log(JSON.stringify({ passed: true, networkAccess: 0, coverage: "empty current semester; no global fallback; independent semester caches; same unit ID isolation; archive preview persistence disabled" }));
