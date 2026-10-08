import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the real projection helpers without Firebase or production data.
const source = fs.readFileSync(
  new URL("../src/lib/wisHallOfFame.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, {
  module,
  exports: module.exports,
  require: () => ({}),
});
const hall = module.exports;
for (const positiveCount of [0, 1, 2, 3, 4]) {
  const entries = Array.from({ length: 5 }, (_, i) => ({
    uid: `fixture-${i}`,
    studentName: `검증학생${i}`,
    displayName: `검증학생${i}`,
    grade: "3",
    class: "1",
    rank: i < positiveCount ? i + 1 : positiveCount + 1,
    cumulativeEarned: i < positiveCount ? 100 - i : 0,
  }));
  for (const storedPodium of [[], entries]) {
    const snapshot = {
      primaryGradeKey: "3",
      gradeLeaderboardByGrade: { 3: entries },
      classLeaderboardByClassKey: { "3-1": entries },
      gradeTop3ByGrade: { 3: storedPodium.filter((e) => e.rank <= 3) },
      classTop3ByClassKey: { "3-1": storedPodium.filter((e) => e.rank <= 3) },
    };
    for (const view of [
      snapshot,
      hall.normalizeWisHallOfFameSnapshot(snapshot),
    ]) {
      assert.equal(hall.getWisHallOfFameGradeLeaderboard(view, "3").length, 5);
      assert.equal(
        hall.getWisHallOfFameClassLeaderboard(view, "3", "1").length,
        5,
      );
      for (const podium of [
        hall.getWisHallOfFameGradeEntries(view, "3"),
        hall.getWisHallOfFameClassEntries(view, "3", "1"),
      ]) {
        assert.equal(podium.length, Math.min(3, positiveCount));
        assert(podium.every((e) => e.cumulativeEarned > 0));
      }
    }
  }
}
console.log(
  "PASS five visible leaderboard entries; zero-Wis students never become podium entries through stored or fallback projections (grade/class, 0–4 positive students).",
);
