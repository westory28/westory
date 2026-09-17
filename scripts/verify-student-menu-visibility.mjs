import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const loadModule = async (file) => {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
  );
};

const { cloneDefaultMenus, sanitizeMenuConfig } = await loadModule(
  "../src/constants/menus.ts",
);
const {
  getStudentRouteAccess,
  getStudentVisibleMenuItems,
  migrateStudentMenuVisibility,
} = await loadModule("../src/lib/studentMenuAccess.ts");

const enabled = { showLesson: true, showQuiz: true, showScore: true };
const route = (pathname, config, menus, search = "") =>
  getStudentRouteAccess({ pathname, search }, config, menus).allowed;
const visible = (menus, config) =>
  getStudentVisibleMenuItems(menus.student, config, menus).map((item) => ({
    url: item.url,
    children: (item.children || []).map((child) => child.url),
  }));

let scenarios = 0;
for (const showLesson of [true, false]) {
  for (const showQuiz of [true, false]) {
    for (const showScore of [true, false]) {
      const config = { showLesson, showQuiz, showScore };
      const legacy = sanitizeMenuConfig(cloneDefaultMenus());
      legacy.student[0].children[1].hidden = true;
      const before = JSON.stringify(legacy);
      const migrated = migrateStudentMenuVisibility(legacy, config);
      const saved = sanitizeMenuConfig(JSON.parse(JSON.stringify(migrated)));
      assert.equal(saved.studentVisibilitySource, "sitemap");
      assert.equal(
        JSON.stringify(legacy),
        before,
        "migration must not alter the loaded source",
      );
      assert.deepEqual(
        visible(saved, config),
        visible(legacy, config),
        "migration must preserve all visible menu targets",
      );
      assert.deepEqual(
        migrateStudentMenuVisibility(saved, enabled),
        saved,
        "migration must be idempotent",
      );
      for (const pathname of [
        "/student/lesson/note",
        "/student/lesson/history-dictionary",
        "/student/quiz",
        "/student/quiz/run",
        "/student/history-classroom",
        "/student/history-classroom/run",
        "/student/score",
        "/student/score/performance",
        "/student/history",
        "/student/points",
      ]) {
        assert.equal(
          route(pathname, config, saved),
          route(pathname, config, legacy),
          pathname,
        );
      }
      scenarios += 1;
    }
  }
}

const disabledQuiz = { ...enabled, showQuiz: false };
const legacy = sanitizeMenuConfig(cloneDefaultMenus());
assert.equal(route("/student/quiz", disabledQuiz, legacy), false);
const saved = migrateStudentMenuVisibility(legacy, disabledQuiz);
const assessment = saved.student.find((item) => item.url === "/student/quiz");
assessment.children.find((child) => child.url === "/student/quiz").hidden =
  false;
const roundTripped = sanitizeMenuConfig(saved);
assert.equal(
  route("/student/quiz", disabledQuiz, roundTripped),
  true,
  "sitemap show must override a retired legacy flag after migration",
);
assert.equal(route("/student/quiz/run", disabledQuiz, roundTripped), true);
assert.equal(
  route("/student/history-classroom", disabledQuiz, roundTripped),
  false,
  "showing quiz must not also reveal history classroom",
);
assert.equal(
  route("/student/history-classroom/run", disabledQuiz, roundTripped),
  false,
);
assessment.children.find((child) => child.url === "/student/quiz").hidden =
  true;
assessment.children.find(
  (child) => child.url === "/student/history-classroom",
).hidden = false;
assert.equal(route("/student/quiz", disabledQuiz, saved), false);
assert.equal(route("/student/history-classroom", disabledQuiz, saved), true);
assert.equal(
  visible(saved, disabledQuiz).find(
    (item) => item.url === "/student/history-classroom",
  ).children.length,
  1,
);

const parentOnly = {
  student: [{ name: "평가", url: "/student/quiz", icon: "" }],
  teacher: [],
};
const migratedParent = migrateStudentMenuVisibility(parentOnly, disabledQuiz);
assert.equal(migratedParent.student[0].hidden, true);
assert.equal(route("/student/quiz", disabledQuiz, migratedParent), false);
assert.deepEqual(visible(migratedParent, disabledQuiz), []);
assert.equal(sanitizeMenuConfig(migratedParent).student[0].hidden, true);
migratedParent.student[0].hidden = false;
assert.equal(route("/student/quiz", disabledQuiz, migratedParent), true);

const points = migrateStudentMenuVisibility(cloneDefaultMenus(), enabled);
points.student
  .find((item) => item.url === "/student/points")
  .children.find((child) => child.url.endsWith("tab=shop")).hidden = true;
assert.equal(route("/student/points", enabled, points), true);
assert.equal(route("/student/points", enabled, points, "?tab=shop"), false);
assert.equal(
  route(
    "/student/points",
    enabled,
    points,
    "?tab=orders&semesterId=2026-2&source=CURRENT",
  ),
  true,
);
assert.equal(route("/student/quiz", null, points), false);
assert.equal(route("/student/quiz", enabled, null), false);
assert.equal(
  sanitizeMenuConfig({ ...legacy, studentVisibilitySource: "unknown" })
    .studentVisibilitySource,
  undefined,
);

const hiddenAssessment = migrateStudentMenuVisibility(
  cloneDefaultMenus(),
  disabledQuiz,
);
hiddenAssessment.student.find((item) => item.url === "/student/quiz").children =
  hiddenAssessment.student
    .find((item) => item.url === "/student/quiz")
    .children.filter((child) => child.url !== "/student/quiz");
const savedDeletion = sanitizeMenuConfig(hiddenAssessment);
assert.equal(
  route("/student/quiz", disabledQuiz, savedDeletion),
  false,
  "deleting a previously hidden child must not reveal it after saving",
);
assert.equal(route("/student/quiz/run", disabledQuiz, savedDeletion), false);
for (const portal of ["student", "teacher"]) {
  const edits = migrateStudentMenuVisibility(cloneDefaultMenus(), enabled);
  const deletedParent = edits[portal].pop();
  const deletedChild = edits[portal][0].children.pop();
  const reloaded = sanitizeMenuConfig(JSON.parse(JSON.stringify(edits)));
  assert.equal(
    reloaded[portal].some((item) => item.url === deletedParent.url),
    false,
    `${portal} deleted parent must remain deleted after reload`,
  );
  assert.equal(
    reloaded[portal][0].children.some(
      (child) => child.url === deletedChild.url,
    ),
    false,
    `${portal} deleted child must remain deleted after reload`,
  );
  assert.deepEqual(sanitizeMenuConfig(reloaded), reloaded);

  const legacyEdits = cloneDefaultMenus();
  legacyEdits[portal].pop();
  legacyEdits[portal][0].children.pop();
  const legacyReloaded = sanitizeMenuConfig(legacyEdits);
  assert.equal(
    legacyReloaded[portal].length,
    cloneDefaultMenus()[portal].length,
  );
  assert.equal(
    legacyReloaded[portal][0].children.length,
    cloneDefaultMenus()[portal][0].children.length,
    "legacy records must retain their existing default menu fallback",
  );
}
assert.deepEqual(
  sanitizeMenuConfig({
    student: [],
    teacher: [],
    studentVisibilitySource: "sitemap",
  }),
  { student: [], teacher: [], studentVisibilitySource: "sitemap" },
  "an explicitly empty sitemap must remain empty",
);

console.log(
  `Student sitemap visibility: PASS (${scenarios} legacy flag combinations, migration, independent child visibility, parent-only visibility, route/query guards, student/teacher deletion and reload)`,
);
