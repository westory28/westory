// Pure plans only: no Firebase initialization, emulator, or network.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const origin = require("../historyDictionaryRewardOrigin");
const uid = "student-a";
const makeOrigin = (year = "2026", semester = "1", termId = "term-original") => ({
  ledgerKind: "legacy-point", uid, termId, year, semester,
  transactionId: origin.getRewardTransactionId(uid, termId),
});
const pathFor = item => `years/${item.year}/semesters/${item.semester}/point_transactions/${item.transactionId}`;
const award = (item, delta = 50) => ({
  path: pathFor(item), data: { uid: item.uid, type: "history_dictionary", sourceId: origin.getRewardSourceId(item.termId), delta },
});
const pair = (item, rewardPatch = {}, reclaim = null) => {
  const reward = award(item);
  return [{ ...reward, data: { ...reward.data, ...rewardPatch } }, { path: `${reward.path}_reclaim`, data: reclaim }];
};
const reclaimFor = item => ({ ...award(item).data, type: "history_dictionary_reclaim", delta: -50 });
const first = makeOrigin(), second = makeOrigin("2026", "2"), third = makeOrigin("2027", "1", "renamed-term");
const word = { uid, termId: "renamed-term", year: "2099", semester: "2", requestOriginTermId: "unrelated-request-origin", rewardOrigins: [first, second] };
const entries = [...pair(first), ...pair(second)];
let checks = 0;
const cases = [];
const eq = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const denied = fn => { assert.throws(fn, error => error.code === "failed-precondition" && error.details?.reason.startsWith("HISTORY_DICTIONARY_REWARD_ORIGIN_")); checks++; };
const test = (name, fn) => { try { fn(); cases.push(name); } catch (error) { error.message = `${name}: ${error.message}`; throw error; } };

test("Original scopes survive business scope and request/term rename", () => {
  const plan = origin.planRewardReclaims({ uid, wordData: word, ledgerEntries: entries });
  eq(plan.rewardOrigins, [first, second]);
  eq(plan.scopes, [{ year: "2026", semester: "1" }, { year: "2026", semester: "2" }]);
  eq(plan.reclaims.map(item => [item.origin.termId, item.amount, item.status]), [["term-original", 50, "reclaim"], ["term-original", 50, "reclaim"]]);
});
test("Append a verified new semester while retaining all original awards", () => {
  const frozen = structuredClone(word), before = structuredClone(entries);
  const result = origin.planAppendRewardOrigin({ uid, wordData: word, ledgerEntries: entries, newOrigin: third, newRewardLedger: award(third) });
  eq(result.rewardOrigins, [first, second, third]);
  eq(word, frozen); eq(entries, before);
  eq(origin.planAppendRewardOrigin({ uid, wordData: word, ledgerEntries: entries, newOrigin: second, newRewardLedger: award(second) }).rewardOrigins, [first, second]);
  eq(origin.planAppendRewardOrigin({ uid, wordData: word, ledgerEntries: entries }).rewardOrigins, [first, second]);
  denied(() => origin.planAppendRewardOrigin({ uid, wordData: word, ledgerEntries: entries, newOrigin: second, newRewardLedger: award(second, 100) }));
});
test("No partial reclaim plan escapes if any original ledger is invalid", () => {
  for (const patch of [{ uid: "other" }, { type: "quiz" }, { sourceId: "history-dictionary:wrong" }, { delta: -50 }, { delta: 0 }, { delta: "50" }, { delta: NaN }, { delta: Infinity }, { reclaimed: "true" }]) {
    denied(() => origin.planRewardReclaims({ uid, wordData: word, ledgerEntries: [...pair(first), ...pair(second, patch)] }));
  }
  denied(() => origin.planRewardReclaims({ uid, wordData: word, ledgerEntries: pair(first) }));
  denied(() => origin.planRewardReclaims({ uid, wordData: word, ledgerEntries: [...pair(first), { path: pathFor(second), data: null }, pair(second)[1]] }));
  denied(() => origin.planAppendRewardOrigin({ uid, wordData: word, ledgerEntries: pair(first), newOrigin: third, newRewardLedger: award(third) }));
});
test("Reclaim ledger must match exact original UID/source/type/amount", () => {
  for (const patch of [{ uid: "other" }, { type: "history_dictionary" }, { sourceId: "history-dictionary:wrong" }, { delta: 50 }, { delta: -49 }, { delta: "-50" }, { delta: NaN }]) {
    denied(() => origin.planRewardReclaims({ uid, wordData: { rewardOrigins: [first] }, ledgerEntries: pair(first, {}, { ...reclaimFor(first), ...patch }) }));
  }
  denied(() => origin.planRewardReclaims({ uid, wordData: { rewardOrigins: [first] }, ledgerEntries: pair(first, { reclaimed: true }) }));
  const settled = origin.planRewardReclaims({ uid, wordData: { rewardOrigins: [first] }, ledgerEntries: pair(first, { reclaimed: true }, reclaimFor(first)) });
  eq(settled.reclaims[0].status, "already-reclaimed"); eq(settled.scopes, []);
  const repair = origin.planRewardReclaims({ uid, wordData: { rewardOrigins: [first] }, ledgerEntries: pair(first, {}, reclaimFor(first)) });
  eq(repair.reclaims[0].status, "repair-marker"); eq(repair.scopes, []);
});
test("Malformed origins and duplicate paths fail closed before reads", () => {
  for (const patch of [{ ledgerKind: undefined }, { ledgerKind: "wis-canonical" }, { uid: "other" }, { termId: "../escape" }, { termId: "" }, { year: 2026 }, { year: "26" }, { semester: 1 }, { semester: "3" }, { transactionId: "arbitrary" }, { transactionId: first.transactionId + "/extra" }, { extra: true }]) {
    denied(() => origin.planRewardOriginReads({ uid, wordData: { rewardOrigins: [{ ...first, ...patch }] } }));
  }
  for (const value of [null, {}, "", [first, first]]) denied(() => origin.planRewardOriginReads({ uid, wordData: { rewardOrigins: value } }));
  denied(() => origin.planRewardOriginReads({ uid, wordData: { uid: "other", rewardOrigins: [first] } }));
  denied(() => origin.planRewardOriginReads({ uid, wordData: { rewardOrigins: [], rewardAmount: 50 } }));
  denied(() => origin.planRewardReclaims({ uid, wordData: { rewardOrigins: [first] }, ledgerEntries: [pair(first)[0]] }));
  denied(() => origin.planRewardReclaims({ uid, wordData: { rewardOrigins: [first] }, ledgerEntries: [...pair(first), pair(first)[0]] }));
});
test("Legacy metadata never chooses a ledger scope or authoritative ID", () => {
  const legacy = { termId: "renamed-term", rewardTermId: first.termId, rewardTransactionId: "unreliable-old-metadata", rewardAmount: 50, year: "2099", semester: "2", requestOriginTermId: "another-origin" };
  const plan = origin.planRewardOriginReads({ uid, wordData: legacy });
  eq(plan.reads, []); eq(plan.legacyUnverified, true);
  denied(() => origin.planRewardReclaims({ uid, wordData: legacy, ledgerEntries: entries }));
  denied(() => origin.planLegacyRewardOriginBackfill({ uid, wordData: legacy, rewardLedgers: [] }));
  const backfill = origin.planLegacyRewardOriginBackfill({ uid, wordData: legacy, rewardLedgers: [award(first), award(second)] });
  eq(backfill.rewardOrigins, [first, second]);
  eq(backfill.reads.map(item => item.rewardPath), [pathFor(first), pathFor(second)]);
  eq(origin.planRewardReclaims({ uid, wordData: legacy, ledgerEntries: entries, legacyRewardOrigins: backfill.rewardOrigins }).rewardOrigins, [first, second]);
  // Discovery alone is insufficient: current transaction must re-read both pairs.
  denied(() => origin.planRewardReclaims({ uid, wordData: legacy, ledgerEntries: [], legacyRewardOrigins: backfill.rewardOrigins }));
  denied(() => origin.planLegacyRewardOriginBackfill({ uid, wordData: legacy, rewardLedgers: [award(third)] }));
  denied(() => origin.planLegacyRewardOriginBackfill({ uid, wordData: legacy, rewardLedgers: [{ ...award(first), path: "point_transactions/" + first.transactionId }] }));
  denied(() => origin.planLegacyRewardOriginBackfill({ uid, wordData: legacy, rewardLedgers: [{ ...award(first), data: { ...award(first).data, uid: "other" } }] }));
  denied(() => origin.planLegacyRewardOriginBackfill({ uid, wordData: word, rewardLedgers: [award(first)] }));
  denied(() => origin.planRewardReclaims({ uid, wordData: legacy, ledgerEntries: pair(third), legacyRewardOrigins: [third] }));
  const explicit = { ...word, rewardTransactionId: "compatibility-only", rewardAmount: 50 };
  eq(origin.planRewardReclaims({ uid, wordData: explicit, ledgerEntries: entries }).rewardOrigins, [first, second]);
});
test("Brand-new unpaid words need no inferred ledger or backfill", () => {
  const clean = {};
  eq(origin.planRewardOriginReads({ uid, wordData: clean }).legacyUnverified, false);
  eq(origin.planRewardReclaims({ uid, wordData: clean, ledgerEntries: [] }).reclaims, []);
  eq(origin.planAppendRewardOrigin({ uid, wordData: clean, ledgerEntries: [], newOrigin: first, newRewardLedger: award(first) }).rewardOrigins, [first]);
  denied(() => origin.planAppendRewardOrigin({ uid, wordData: clean, ledgerEntries: [], newOrigin: first, newRewardLedger: { ...award(first), path: pathFor(second) } }));
  denied(() => origin.planAppendRewardOrigin({ uid, wordData: clean, ledgerEntries: [], newOrigin: first, newRewardLedger: { ...award(first), data: { ...award(first).data, reclaimed: true } } }));
});
test("Legacy rows with missing reward metadata require completed discovery", () => {
  const legacy = { termId: first.termId, year: "2099", semester: "2", rewardAmount: 0 };
  eq(origin.planRewardOriginReads({ uid, wordData: legacy }).legacyNeedsDiscovery, true);
  denied(() => origin.planAppendRewardOrigin({ uid, wordData: legacy, ledgerEntries: [], newOrigin: second, newRewardLedger: award(second) }));
  const found = origin.planLegacyRewardOriginBackfill({ uid, wordData: legacy, rewardLedgers: [award(first)] });
  eq(origin.planAppendRewardOrigin({ uid, wordData: legacy, ledgerEntries: pair(first), legacyRewardOrigins: found.rewardOrigins, newOrigin: second, newRewardLedger: award(second) }).rewardOrigins, [first, second]);
  const empty = origin.planLegacyRewardOriginBackfill({ uid, wordData: legacy, rewardLedgers: [] });
  eq(origin.planAppendRewardOrigin({ uid, wordData: legacy, ledgerEntries: [], legacyRewardOrigins: empty.rewardOrigins, newOrigin: second, newRewardLedger: award(second) }).rewardOrigins, [second]);
});
test("Existing ledger ID/source contract matches actual index helper code", () => {
  const source = readFileSync(resolve(__dirname, "../index.js"), "utf8");
  const snippet = (from, until) => {
    const start = source.indexOf(from), end = source.indexOf(until, start);
    assert.ok(start >= 0 && end > start); return source.slice(start, end);
  };
  const actual = runInNewContext(snippet("const sanitizeKeyPart =", "const sanitizeNotificationText =") +
    snippet("const buildActivityTransactionId =", "const buildPurchaseRequestId =") +
    snippet("const getHistoryDictionaryRewardSourceId =", "const getHistoryDictionaryDefinitionQualityLength =") +
    "({getHistoryDictionaryRewardSourceId,getHistoryDictionaryRewardTransactionId})");
  for (const termId of ["term-original", "legacy-original-id", "term:한국사"])
    for (const studentUid of [uid, "uid.with.symbols", "long".repeat(32)]) {
      eq(origin.getRewardSourceId(termId), actual.getHistoryDictionaryRewardSourceId(termId));
      eq(origin.getRewardTransactionId(studentUid, termId), actual.getHistoryDictionaryRewardTransactionId(studentUid, termId));
    }
});
console.log(JSON.stringify({ status: "PASS", checks, cases, coverage: "Pure origin read/backfill/append/reclaim plans; actual legacy index ID helpers; no writer integration, wallet mutation, or delivery test" }, null, 2));
