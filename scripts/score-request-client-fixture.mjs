import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as firestore from "firebase/firestore";

// Load the actual UI query and path builders with a local Firestore instance.
// The production Firebase app must never be initialized by this test.
function loadSource(path, modules) {
  const source = readFileSync(path, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const exports = {};
  vm.runInNewContext(
    outputText,
    {
      exports,
      require(id) {
        if (!Object.hasOwn(modules, id))
          throw new Error(`Unexpected dependency: ${id}`);
        return modules[id];
      },
    },
    { filename: path },
  );
  return exports;
}

const scope = loadSource("src/lib/semesterScope.ts", {
  "./semesterArchive": {},
});
const scores = loadSource("src/lib/performanceScores.ts", {
  "firebase/firestore": firestore,
  "./firebase": {},
  "./semesterScope": scope,
});
const { getTeacherScoreRequestQuery } = loadSource(
  "src/pages/teacher/components/teacherScoreRequestQuery.ts",
  { "firebase/firestore": firestore, "../../../lib/performanceScores": scores },
);
export const collections = [
  scores.PERFORMANCE_SCORE_OBJECTIONS_COLLECTION,
  scores.PERFORMANCE_SCORE_ANSWER_SHEET_REQUESTS_COLLECTION,
];
export const kinds = [
  scores.PERFORMANCE_SCORE_KIND,
  scores.WRITTEN_EXAM_SCORE_KIND,
];
export const clientQuery = (db, name, kind, semester = "2") =>
  getTeacherScoreRequestQuery(
    db,
    scope.getSemesterCollectionPath({ year: "2026", semester }, name),
    kind,
  );
