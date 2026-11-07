import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["src/lib/historyAchievement.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const model = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const tree = [
  {
    id: "joseon",
    title: "Ⅳ. 조선의 성립과 발전",
    children: [
      {
        id: "politics",
        title: "사림 세력과 정치 변화",
        children: [
          { id: "factions", title: "붕당의 형성" },
          { id: "both", title: "사림과 유교 문화" },
        ],
      },
      {
        id: "culture",
        title: "문화의 발달과 사회 변화",
        children: [{ id: "alphabet", title: "훈민정음 창제" }],
      },
      { id: "war", title: "왜란과 호란" },
    ],
  },
];
assert.equal(model.HISTORY_ACHIEVEMENT_STANDARDS.length, 23);
assert.equal(
  new Set(model.HISTORY_ACHIEVEMENT_STANDARDS.map((s) => s.code)).size,
  23,
);
assert.deepEqual(
  model.inferHistoryAchievementStandards(tree, ["factions"]).codes,
  ["9역10-02"],
);
assert.deepEqual(
  model.inferHistoryAchievementStandards(tree, ["alphabet"]).codes,
  ["9역10-03"],
);
assert.deepEqual(
  model.inferHistoryAchievementStandards(tree, ["joseon", "war"]).codes,
  ["9역10-04"],
);
assert.equal(
  model.inferHistoryAchievementStandards(tree, ["joseon"]).ambiguous,
  true,
);
assert.deepEqual(
  model.inferHistoryAchievementStandards(tree, ["joseon"]).codes,
  [],
);
assert.deepEqual(
  model.inferHistoryAchievementStandards(tree, ["unknown"]).codes,
  [],
);
assert.deepEqual(
  model.resolveQuestionAchievement({ unitId: "factions" }, tree),
  { codes: ["9역10-02"], source: "unit-inferred" },
);
assert.deepEqual(
  model.resolveQuestionAchievement(
    {
      unitId: "factions",
      achievementMappingSource: "manual",
      achievementStandardCodes: [],
    },
    tree,
  ),
  { codes: [], source: "none" },
);
assert.deepEqual(
  model.resolveQuestionAchievement(
    { unitId: "factions", curriculumVersion: "2022" },
    tree,
  ),
  { codes: [], source: "none" },
);
assert.deepEqual(
  model.resolveQuestionAchievement(
    {
      unitId: "factions",
      curriculumVersion: "2018-162",
      achievementStandardCodes: ["9역10-03"],
      achievementMappingSource: "manual",
    },
    tree,
  ),
  { codes: ["9역10-03"], source: "manual" },
);
assert.equal(
  model.validateHistoryAchievementMetadata({
    curriculumVersion: "2018-162",
    achievementStandardCodes: ["9역10-02"],
    targetAchievementLevel: "B",
    intendedDifficulty: "medium",
  }),
  "",
);
assert.ok(
  model.validateHistoryAchievementMetadata({
    achievementStandardCodes: ["9역99-01"],
  }),
);
assert.ok(
  model.validateHistoryAchievementMetadata({ targetAchievementLevel: "A" }),
);
assert.deepEqual(model.normalizeHistoryAchievementMetadata({}), {});
for (const standard of model.HISTORY_ACHIEVEMENT_STANDARDS) {
 const rubric=model.getHistoryAchievementRubric(standard.code);
 assert.ok(rubric);
 assert.deepEqual(Object.keys(rubric.levels),['A','B','C','D','E']);
 assert.ok(rubric.sourcePages.length && rubric.sourceStandards.length && rubric.mappingNote);
}
assert.equal(model.HISTORY_ACHIEVEMENT_RUBRIC_VERSION,'2018-history2-adapted-2025-v1');
console.log("History achievement: 15 mapping checks and 23 adapted A–E rubrics passed");
