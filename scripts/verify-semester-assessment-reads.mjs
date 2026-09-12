import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const compileInitializer = (path, name, bindings) => {
  const file = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let initializer;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name)
      initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert(initializer, `${path}: ${name}`);
  const js = ts.transpileModule(`return ${initializer.getText(file)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(bindings), js)(...Object.values(bindings));
};

let cases = 0;
for (const [path, name, returnsTree] of [
  ["src/pages/teacher/ManageQuiz.tsx", "loadTree", false],
  ["src/pages/teacher/components/QuizUnitTree.tsx", "loadTree", false],
  ["src/pages/teacher/components/QuizBankTab.tsx", "loadTreeData", true],
]) {
  for (const semester of ["1", "2"]) {
    const expectedPath = `years/2026/semesters/${semester}/curriculum/tree`;
    const preservedTree = [
      { id: "first-semester-only", title: "Archived unit" },
    ];
    const reads = [];
    let displayed = preservedTree;
    const load = compileInitializer(path, name, {
      config: { year: "2026", semester },
      db: {},
      getSemesterDocPath: (config, collection, id) =>
        `years/${config.year}/semesters/${config.semester}/${collection}/${id}`,
      doc: (_db, ...parts) => parts.join("/"),
      getDoc: async (documentPath) => {
        reads.push(documentPath);
        // A legacy global tree exists but must never be used for an empty semester.
        const exists = documentPath === "curriculum/tree" || semester === "1";
        return { exists: () => exists, data: () => ({ tree: preservedTree }) };
      },
      setTreeData: (value) => {
        displayed = value;
      },
      console,
    });
    const result = await load();
    assert.deepEqual(reads, [expectedPath]);
    assert.deepEqual(
      returnsTree ? result : displayed,
      semester === "1" ? preservedTree : [],
    );
    cases++;
  }
}

let reads = 0;
let error = "";
const legacyLoad = compileInitializer(
  "src/pages/student/history-classroom/HistoryClassroomRunner.tsx",
  "loadAssignment",
  {
    userData: { uid: "synthetic-student" },
    assignmentId: "old-assignment",
    explicitLegacySource: true,
    setLoading() {},
    setError(value) {
      error = value;
    },
    setLegacySource() {},
    setLegacyNoticeOpen() {},
    getAssessmentState: async () => {
      reads++;
      throw new Error("Unexpected assessment read");
    },
    getDoc: async () => {
      reads++;
      throw new Error("Unexpected document read");
    },
    console: { error() {} },
  },
);
await legacyLoad();
assert.equal(reads, 0);
assert.match(error, /현재 학기/);
cases++;
console.log(
  JSON.stringify({
    suite: "semester-assessment-reads",
    cases,
    status: "PASS",
    productionAccess: 0,
  }),
);
