import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertIncludes = (source, expected, message) => {
  assert(source.includes(expected), message);
};

const assertMatches = (source, pattern, message) => {
  assert(pattern.test(source), message);
};

const semesterScope = read("src/lib/semesterScope.ts");
const studentLessonReadCache = read("src/lib/studentLessonReadCache.ts");
const points = read("src/lib/points.ts");
const myPage = read("src/pages/student/MyPage.tsx");
const manageLesson = read("src/pages/teacher/ManageLesson.tsx");
const functionsIndex = read("functions/index.js");
const rules = read("firestore.rules");

assertIncludes(
  semesterScope,
  "getSameYearSemesterCandidates",
  "semesterScope must expose same-academic-year semester candidates.",
);
assertMatches(
  semesterScope,
  /const semesters = \[semester, DEFAULT_SEMESTER, "2"\]/,
  "Same-year candidates must prefer the active semester, then first and second semester fallbacks.",
);
assertMatches(
  semesterScope,
  /return Array\.from\(new Set\(semesters\.filter\(Boolean\)\)\)\.map\(\(item\) => \(\{\s*year,\s*semester: item,\s*\}\)\);/s,
  "Same-year candidates must keep the active academic year and only vary semester.",
);

assertIncludes(
  studentLessonReadCache,
  "return `${year}:academic-year`;",
  "Student lesson cache must be keyed by academic year so semester switches reuse lesson resources.",
);
assertMatches(
  studentLessonReadCache,
  /for \(const candidate of getSameYearSemesterCandidates\(config\)\)[\s\S]*getSemesterDocPath\(candidate, "curriculum", "tree"\)/,
  "Student curriculum tree reads must search the same academic year before legacy fallback.",
);
assertMatches(
  studentLessonReadCache,
  /for \(const candidate of getSameYearSemesterCandidates\(config\)\)[\s\S]*getSemesterCollectionPath\(candidate, "lessons"\)/,
  "Student lesson reads must search the same academic year before legacy fallback.",
);
assertMatches(
  studentLessonReadCache,
  /for \(const candidate of getSameYearSemesterCandidates\(config\)\)[\s\S]*getSemesterCollectionPath\(candidate, "map_resources"\)/,
  "Student map resource reads must search the same academic year before legacy fallback.",
);

assertMatches(
  manageLesson,
  /for \(const candidate of getSameYearSemesterCandidates\(config\)\)[\s\S]*getSemesterCollectionPath\(candidate, "lessons"\)/,
  "Teacher lesson reads must find existing same-year lesson documents.",
);
assertIncludes(
  manageLesson,
  'getSemesterDocPath(config, "curriculum", "tree")',
  "Teacher curriculum tree writes must still target the active semester document.",
);

assertIncludes(
  points,
  "getSameYearSemesterCandidates",
  "Client point helpers must use same-year semester candidates.",
);
for (const collectionName of [
  "point_wallets",
  "point_policies",
  "point_transactions",
  "point_products",
  "point_orders",
]) {
  assertIncludes(
    points,
    collectionName,
    `Client point helpers must keep ${collectionName} in the academic-year continuity surface.`,
  );
}
assertMatches(
  points,
  /for \(const path of getSameYearPointWalletDocPaths\(config, uid\)\)/,
  "Point wallet reads must fall back within the same academic year.",
);
assertMatches(
  points,
  /for \(const path of getSameYearPointPolicyDocPaths\(config\)\)/,
  "Point policy reads must fall back within the same academic year.",
);

assertIncludes(
  functionsIndex,
  "const getSameYearSemesterCandidates = (year, semester) =>",
  "Functions must have a server-side same-year semester helper.",
);
assertIncludes(
  functionsIndex,
  "loadPointProductForSameYear",
  "Point product purchases and approvals must resolve same-year fallback products.",
);
assertMatches(
  functionsIndex,
  /const walletSnapshots = await runHallOfFameRefreshStage[\s\S]*getSameYearSemesterCandidates\(year, semester\)/,
  "WIS hall of fame must read point wallets across the selected academic year.",
);
assertMatches(
  functionsIndex,
  /for \(const candidate of getSameYearSemesterCandidates\(year, semester\)\)[\s\S]*legacyWalletRef/,
  "Functions must seed a missing active-semester wallet from same-year wallet data.",
);
assertMatches(
  functionsIndex,
  /const listActivityTransactionsByType[\s\S]*getSameYearSemesterCandidates\(year, semester\)/,
  "Activity reward duplicate checks must look across the same academic year.",
);

assertIncludes(
  myPage,
  "const scoreScopeKey = `${year}_${semester}`;",
  "MyPage goal state must be scoped by active year and semester.",
);
assertIncludes(
  myPage,
  'semester === "1" ? data.myPageGoalScore || "" : ""',
  "Legacy MyPage goal fallback must only apply to first semester.",
);
assertIncludes(
  myPage,
  "myPageGoalScoresBySemester",
  "MyPage goal saves must use semester-scoped maps.",
);
assertIncludes(
  myPage,
  "const scoreDocId = `${year}_${semester}`;",
  "MyPage score documents must remain semester-specific.",
);
assertIncludes(
  myPage,
  'collection(db, getSemesterCollectionPath(config, "grading_plans"))',
  "MyPage grading plans must remain active-semester specific.",
);
assertIncludes(
  myPage,
  "loadStudentQuizResults(config, user.uid)",
  "MyPage quiz results must remain active-semester specific.",
);

assertIncludes(
  rules,
  "myPageGoalScoresBySemester",
  "Firestore rules must allow semester-scoped MyPage goal scores.",
);
assertIncludes(
  rules,
  "myPageSubjectGoalsBySemester",
  "Firestore rules must allow semester-scoped MyPage subject goals.",
);
assertMatches(
  rules,
  /myPageGoalScoresBySemester\.keys\(\)\.size\(\) <= 12/,
  "Semester-scoped MyPage goal score map must remain bounded.",
);
assertMatches(
  rules,
  /myPageSubjectGoalsBySemester\.keys\(\)\.size\(\) <= 12/,
  "Semester-scoped MyPage subject goal map must remain bounded.",
);

console.log("Academic-year scope continuity checks passed.");
