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
console.log("PASS student emoji: current-semester thresholds, saved-icon fallback, all ranking groups, stale response and missing-account denial");
