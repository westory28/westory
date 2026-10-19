import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const { outputFiles } = await build({
  stdin: {
    contents: 'export * from "./src/lib/studentProfileEmoji"; export * from "./src/lib/pointRanks";',
    resolveDir: fileURLToPath(root),
  },
  bundle: true, write: false, platform: "node", format: "cjs",
});
const module = { exports: {} };
vm.runInNewContext(outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url) });
const { resolveStudentProfileEmoji: resolve, resolveStudentHallProfileEmojis: resolveHall, resolvePointRankPolicy } = module.exports;
const policy = resolvePointRankPolicy({
  tiers: [
    { code: "tier_1", minPoints: 0, allowedEmojiIds: ["smile"] },
    { code: "tier_2", minPoints: 50, allowedEmojiIds: ["cool"] },
    { code: "tier_5", minPoints: 500, allowedEmojiIds: ["fox"] },
  ],
});
const oldProfile = { profileEmojiId: "fox", profileIcon: "🦊" };
assert.equal(resolve(policy, 0, oldProfile).entry.id, "smile");
assert.equal(resolve(policy, 499, oldProfile).entry.id, "smile");
assert.equal(resolve(policy, 500, oldProfile).entry.id, "fox");
assert.equal(resolve(policy, 49, { profileIcon: "😎" }).entry.id, "smile");
assert.equal(resolve(policy, 50, { profileIcon: "😎" }).entry.id, "cool");
assert.equal(resolve(policy, NaN, oldProfile).entry.id, "smile");
assert.equal(resolve(policy, -1, oldProfile).entry.id, "smile");
assert.equal(resolve(policy, 500, { profileEmojiId: "unknown", profileIcon: "🦊" }).entry.id, "smile");
const disabledPolicy = resolvePointRankPolicy({ ...policy, emojiPolicy: { ...policy.emojiPolicy, enabled: false } });
assert.equal(resolve(disabledPolicy, 0, oldProfile).entry.id, "smile", "A display setting never grants higher-tier emoji access");
assert.equal(resolve(disabledPolicy, 500, oldProfile).entry.id, "fox");
const entries = [
  { uid: "low", cumulativeEarned: 0, profileIcon: "🦊", rank: 2 },
  { uid: "high", cumulativeEarned: 500, profileIcon: "🦊", rank: 1 },
];
const snapshot = Object.fromEntries([
  "gradeTop3ByGrade", "classTop3ByClassKey", "gradeLeaderboardByGrade", "classLeaderboardByClassKey",
].map(key => [key, { group: entries }]));
const result = resolveHall(snapshot, policy);
for (const group of Object.values(result)) {
  assert.equal(group.group[0].profileIcon, "😀");
  assert.equal(group.group[1].profileIcon, "🦊");
  assert.equal(group.group[0].rank, 2);
}
assert.equal(entries[0].profileIcon, "🦊", "Do not rewrite saved preferences or shared ranking data");

// Exercise the actual asynchronous loader with a late previous-semester response.
const page = await readFile(new URL("src/pages/student/MyPage.tsx", root), "utf8");
const loader = page.slice(page.indexOf("  const loadPointRankState = async () => {"), page.indexOf("  useEffect(() => {", page.indexOf("  const loadPointRankState = async () => {")));
let resolveWallet;
const context = {
  pointRankRequestRef: { current: 0 }, pointRankScopeRef: { current: "student:2026:1" },
  pointRankScopeKey: "student:2026:1", user: { uid: "student" }, config: { year: "2026", semester: "1" },
  getPointWalletByUid: () => new Promise(resolve => { resolveWallet = resolve; }),
  getPointPolicy: async () => ({ rankPolicy: policy }),
  setLoadedPointRankKey(value) { context.loaded = value; },
  setPointRankError(value) { context.error = value; },
  setPointWallet(value) { context.wallet = value; },
  setPointPolicy() {}, console: { error() {} },
};
vm.runInNewContext(`${loader}\nglobalThis.load = loadPointRankState;`, context);
const pending = context.load();
context.pointRankScopeRef.current = "student:2026:2";
resolveWallet({ rankEarnedTotal: 10000 });
await pending;
assert.equal(context.loaded, "");
assert.equal(context.wallet, undefined, "Late first-semester score must not replace the current score");
context.pointRankScopeRef.current = context.pointRankScopeKey;
const missing = context.load();
resolveWallet(null);
await missing;
assert.equal(context.loaded, "");
assert.equal(context.wallet, null);
assert.ok(context.error);
// Execute the real recognition loader: an old public snapshot must never grant
// its emoji to a student whose canonical score no longer permits it.
const recognitionSource = await readFile(new URL("src/lib/wisHallOfFameRecognition.ts", root), "utf8");
const recognitionBuild = await build({
  stdin: { contents: recognitionSource, loader: "ts", resolveDir: fileURLToPath(new URL("src/lib/", root)) },
  bundle: true, write: false, platform: "node", format: "cjs",
  plugins: [{ name: "recognition-boundaries", setup(builder) {
    builder.onResolve({ filter: /^\.\/(wisHallOfFame|safeStorage|studentWis|points|studentProfileEmoji)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: ({
      "./wisHallOfFame": `export const getWisHallOfFameSnapshot = async () => ({});
        export const findWisHallOfFameRecognition = () => globalThis.fixture.recognition;
        export const isHallOfFameRecognitionEnabled = () => true;
        export const buildWisHallOfFameSeenStorageKey = () => "fixture-seen";`,
      "./safeStorage": "export const readLocalOnly = () => null; export const writeLocalOnly = () => {};",
      "./studentWis": "export const getStudentPointWallet = async () => globalThis.fixture.wallet;",
      "./points": "export const getPointPolicy = async () => { if (globalThis.fixture.failPolicy) throw Error('denied'); return { rankPolicy: globalThis.fixture.policy }; };",
      "./studentProfileEmoji": "export const resolveStudentProfileEmoji = (...args) => globalThis.resolve(...args);",
    })[args.path] }));
  } }],
});
const recognitionContext = {
  module: { exports: {} }, resolve, console: { warn() {} },
  fixture: {
    policy, wallet: { rankEarnedTotal: 0 }, failPolicy: false,
    recognition: { scope: "grade", entry: { rank: 1, grade: "3", class: "1", studentName: "학생", profileIcon: "👑" } },
  },
};
vm.runInNewContext(recognitionBuild.outputFiles[0].text, recognitionContext);
const loadRecognition = recognitionContext.module.exports.loadHallOfFameRecognition;
const currentProfile = { uid: "student", grade: "3", class: "1", ...oldProfile };
assert.equal((await loadRecognition({ year: "2026", semester: "2" }, currentProfile)).profileIcon, "😀");
recognitionContext.fixture.wallet.rankEarnedTotal = 500;
assert.equal((await loadRecognition({ year: "2026", semester: "2" }, currentProfile)).profileIcon, "🦊");
recognitionContext.fixture.wallet = null;
assert.equal(await loadRecognition({ year: "2026", semester: "2" }, currentProfile), null);
recognitionContext.fixture.failPolicy = true;
assert.equal(await loadRecognition({ year: "2026", semester: "2" }, currentProfile), null);
console.log("PASS student emoji: current-semester thresholds, all ranking groups, stale response, missing-account denial and recognition popup authority");
