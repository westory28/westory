/** Callable-boundary regression checks with an atomic in-memory Firestore.
 * These exercise real Weplay handlers. They do not replace emulator/deployed QA.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { createWeplayFunctions } = require(
  path.join(root, "functions/weplay.js"),
);
const core = require(path.join(root, "functions/weplayCore.js"));
const { simulateWeplayBattle } = require(path.join(root, "functions/weplayBattle.js"));
const clone = (value) =>
  value === undefined ? undefined : structuredClone(value);
const scope = { year: "2026", semester: "2" };
const prefix = "years/2026/semesters/2";
const oldNow = Date.now;
let now = Date.parse("2026-09-29T01:00:00Z");
Date.now = () => now;
const checks = [];
class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
class Store {
  data = new Map();
  tail = Promise.resolve();
  snapshot(ref) {
    const value = this.data.get(ref.path);
    return {
      id: ref.id,
      ref,
      exists: value !== undefined,
      data: () => clone(value),
    };
  }
  doc(path) {
    return new Ref(this, path);
  }
  collection(path) {
    return new Query(this, path);
  }
  async runTransaction(callback) {
    const run = this.tail.then(async () => {
      const mutations = [];
      const transaction = {
        get: async (ref) => {
          assert.equal(
            mutations.length,
            0,
            "Firestore transaction reads must precede writes",
          );
          return ref instanceof Query ? ref.get() : this.snapshot(ref);
        },
        set: (ref, data, options = {}) =>
          mutations.push({ kind: "set", ref, data: clone(data), options }),
        create: (ref, data) =>
          mutations.push({ kind: "create", ref, data: clone(data) }),
        update: (ref, data) =>
          mutations.push({ kind: "update", ref, data: clone(data) }),
        delete: (ref) => mutations.push({ kind: "delete", ref }),
      };
      const result = await callback(transaction);
      const next = new Map(this.data);
      for (const { kind, ref, data, options } of mutations) {
        if (kind === "delete") {
          next.delete(ref.path);
          continue;
        }
        if (kind === "create")
          assert(!next.has(ref.path), `Duplicate create: ${ref.path}`);
        if (kind === "update")
          assert(next.has(ref.path), `Missing update: ${ref.path}`);
        const value =
          kind === "update" || options?.merge
            ? clone(next.get(ref.path) || {})
            : {};
        for (const [key, item] of Object.entries(data)) {
          const keys = kind === "update" ? key.split(".") : [key];
          let cursor = value;
          for (const segment of keys.slice(0, -1))
            cursor = cursor[segment] ??= {};
          cursor[keys.at(-1)] = item;
        }
        next.set(ref.path, value);
      }
      this.data = next;
      return result;
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}
class Ref {
  constructor(store, path) {
    this.store = store;
    this.path = path;
    this.id = path.split("/").at(-1);
  }
  async get() {
    return this.store.snapshot(this);
  }
  collection(name) {
    return new Query(this.store, `${this.path}/${name}`);
  }
  async set(data, options = {}) {
    this.store.data.set(
      this.path,
      options.merge
        ? { ...clone(this.store.data.get(this.path) || {}), ...clone(data) }
        : clone(data),
    );
  }
}
class Query {
  constructor(store, path, filters = [], sort = null, count = Infinity) {
    Object.assign(this, { store, path, filters, sort, count });
  }
  doc(id) {
    return this.store.doc(`${this.path}/${id}`);
  }
  where(field, op, value) {
    return new Query(
      this.store,
      this.path,
      [...this.filters, { field, op, value }],
      this.sort,
      this.count,
    );
  }
  orderBy(field, direction = "asc") {
    return new Query(
      this.store,
      this.path,
      this.filters,
      { field, direction },
      this.count,
    );
  }
  limit(count) {
    return new Query(this.store, this.path, this.filters, this.sort, count);
  }
  async get() {
    const level = this.path.split("/").length + 1;
    let docs = [...this.store.data.keys()]
      .filter(
        (key) =>
          key.startsWith(`${this.path}/`) && key.split("/").length === level,
      )
      .map((key) => this.store.snapshot(this.store.doc(key)));
    docs = docs.filter((doc) =>
      this.filters.every(({ field, op, value }) =>
        op === "=="
          ? doc.data()[field] === value
          : op === "<="
            ? doc.data()[field] <= value
            : false,
      ),
    );
    if (this.sort)
      docs.sort(
        (a, b) =>
          (this.sort.direction === "desc" ? -1 : 1) *
          ((a.data()[this.sort.field] > b.data()[this.sort.field]) -
            (a.data()[this.sort.field] < b.data()[this.sort.field])),
      );
    return {
      docs: docs.slice(0, this.count),
      empty: !docs.length,
      size: Math.min(docs.length, this.count),
    };
  }
}
function setup() {
  const db = new Store();
  db.data.set("site_settings/config", scope);
  for (const [uid, grade, group] of [
    ["student-a", 2, 1],
    ["student-b", 2, 1],
    ["student-c", 2, 1],
    ["student-d", 2, 2],
  ]) {
    db.data.set(`users/${uid}`, {
      uid,
      role: "student",
      name: "검증학생",
      grade,
      class: group,
      number: 1,
    });
    db.data.set(`${prefix}/point_wallets/${uid}`, {
      uid,
      balance: 30,
      earnedTotal: 30,
      rankEarnedTotal: 30,
      spentTotal: 0,
      adjustedTotal: 0,
    });
  }
  db.data.set(`${prefix}/lessons/one`, {
    unitId: "one",
    title: "공개 수업",
    isVisibleToStudents: true,
    contentHtml: "[훈민정음] [고려] [삼국통일]",
  });
  db.data.set(`${prefix}/lessons/private`, {
    unitId: "private",
    title: "비공개 수업",
    isVisibleToStudents: false,
    contentHtml: "[비공개정답]",
  });
  db.data.set("lessons/private", {
    unitId: "private",
    title: "옛 공개 수업",
    isVisibleToStudents: true,
    contentHtml: "[과거정답]",
  });
  db.data.set(`${prefix}/weplay_policies/current`, clone(core.DEFAULT_POLICY));
  const auth = (request) => {
    if (!request.auth?.uid) throw new ApiError("unauthenticated", "인증 필요");
    return { uid: request.auth.uid };
  };
  const manager = async (request) => {
    const actor = auth(request);
    if (actor.uid !== "teacher")
      throw new ApiError("permission-denied", "교사 권한 필요");
    return actor;
  };
  const base = (uid, profile) => ({
    uid,
    studentName: profile.studentName || profile.name || "",
    grade: String(profile.grade || ""),
    class: String(profile.class || ""),
    number: String(profile.number || ""),
  });
  const api = createWeplayFunctions({
    db,
    onCall: (_options, handler) => handler,
    onSchedule: (_options, handler) => handler,
    HttpsError: ApiError,
    FieldValue: {
      serverTimestamp: () => ({ seconds: Math.floor(now / 1000) }),
    },
    REGION: "asia-northeast3",
    assertAllowedWestoryUser: auth,
    assertPointManager: manager,
    assertPointReader: manager,
    assertWeplayReader: manager,
    assertWeplayManager: manager,
    getUserProfile: async (uid) => ({
      profile: clone(db.data.get(`users/${uid}`) || {}),
    }),
    ensureWallet: async (transaction, year, semester, uid, profile) => {
      const ref = db.doc(
        `years/${year}/semesters/${semester}/point_wallets/${uid}`,
      );
      const snapshot = await transaction.get(ref);
      return {
        ref,
        wallet: snapshot.data() || {
          ...base(uid, profile),
          balance: 0,
          earnedTotal: 0,
          rankEarnedTotal: 0,
          spentTotal: 0,
          adjustedTotal: 0,
        },
      };
    },
    loadPolicy: async (transaction, year, semester) => {
      await transaction.get(
        db.doc(`years/${year}/semesters/${semester}/point_policies/current`),
      );
      return { rankPolicy: {} };
    },
    getCurrentRankEarnedTotal: async (
      _transaction,
      _year,
      _semester,
      _uid,
      wallet,
    ) => Number(wallet.rankEarnedTotal || 0),
    buildWalletBase: base,
    buildWalletRankState: (total) => ({ rankEarnedTotal: total }),
    createTransactionPayload: (data) => data,
    markWisHallOfFameDirtySafely: async () => undefined,
  });
  const call = (name, data = {}, uid = "student-a") =>
    api[name]({
      auth: uid ? { uid } : null,
      data: {
        ...scope,
        ...(name === "startWeplayGame" ? { difficulty: "medium" } : {}),
        ...data,
      },
    });
  return { db, api, call };
}
const rejectCode = (promise, code) =>
  assert.rejects(promise, (error) => error.code === code);
async function play(call, uid, key, correct, difficulty = "medium") {
  const session = await call(
    "startWeplayGame",
    { mode: "challenge", requestKey: key, difficulty },
    uid,
  );
  for (const word of session.words.slice(0, correct)) {
    now = session.startsAtMs + word.spawnAtMs + 101;
    const verdict = await call(
      "submitWeplayAnswer",
      {
        sessionId: session.id,
        eventId: `answer-${word.id}`,
        wordId: word.id,
        answer: word.text,
      },
      uid,
    );
    assert.equal(verdict.accepted, true);
  }
  now = session.endsAtMs + 1000;
  return {
    session,
    result: await call("finishWeplayGame", { sessionId: session.id }, uid),
  };
}
try {
  let { db, api, call } = setup();
  await rejectCode(call("getWeplayLobby", {}, null), "unauthenticated");
  await rejectCode(call("getWeplayLobby", {}, "teacher"), "permission-denied");
  await rejectCode(
    call("saveWeplayPolicy", { policy: core.DEFAULT_POLICY }),
    "permission-denied",
  );
  await rejectCode(
    api.startWeplayGame({
      auth: { uid: "student-a" },
      data: { ...scope, mode: "challenge", requestKey: "missing-difficulty" },
    }),
    "invalid-argument",
  );
  await rejectCode(
    call("startWeplayGame", {
      mode: "challenge",
      requestKey: "invalid-difficulty",
      difficulty: "unknown",
    }),
    "invalid-argument",
  );
  const incompletePolicy = clone(core.DEFAULT_POLICY);
  delete incompletePolicy.rankingRewards.spicy;
  await rejectCode(
    call("saveWeplayPolicy", { policy: incompletePolicy }, "teacher"),
    "invalid-argument",
  );
  await rejectCode(
    call("startWeplayGame", {
      year: "2025",
      mode: "challenge",
      requestKey: "old",
    }),
    "failed-precondition",
  );
  await rejectCode(
    call("startWeplayGame", {
      year: "../../users",
      mode: "challenge",
      requestKey: "invalid",
    }),
    "invalid-argument",
  );
  const lobby = await call("getWeplayLobby");
  assert.equal(
    lobby.wordCount,
    3,
    "A hidden scoped lesson must suppress its legacy public fallback",
  );
  assert.deepEqual(
    lobby.lessons.map((lesson) => lesson.unitId),
    ["one"],
  );
  checks.push(
    "Auth, student/manager roles, current-semester/path validation, hidden lesson precedence",
  );

  const starts = await Promise.all([
    call("startWeplayGame", { mode: "challenge", requestKey: "same" }),
    call("startWeplayGame", { mode: "challenge", requestKey: "same" }),
  ]);
  assert.equal(starts[0].id, starts[1].id);
  assert.equal(db.data.get(`${prefix}/point_wallets/student-a`).balance, 28);
  assert.equal(
    db.data.get(`${prefix}/weplay_players/student-a`).challengeUsed,
    1,
  );
  assert.equal(
    [...db.data.keys()].filter((key) =>
      key.includes("/point_transactions/weplay_cost_"),
    ).length,
    1,
  );
  await rejectCode(
    call("startWeplayGame", { mode: "challenge", requestKey: "other" }),
    "already-exists",
  );
  const active = starts[0];
  await rejectCode(
    call(
      "submitWeplayAnswer",
      {
        sessionId: active.id,
        eventId: "steal",
        wordId: active.words[0].id,
        answer: active.words[0].text,
      },
      "student-b",
    ),
    "permission-denied",
  );
  await rejectCode(
    call("finishWeplayGame", { sessionId: active.id }, "student-b"),
    "permission-denied",
  );
  await rejectCode(
    call("finishWeplayGame", { sessionId: active.id }),
    "failed-precondition",
  );
  checks.push(
    "Concurrent identical starts: one charge/count; different active start blocked; foreign answer/finish and early finish denied",
  );

  const changed = clone(core.DEFAULT_POLICY);
  changed.challengeCost = 99;
  changed.resultRewards = changed.resultRewards.map((row) => ({
    ...row,
    amount: 999,
  }));
  changed.rankingRewards = Object.fromEntries(
    ["mild", "medium", "spicy"].map((difficulty) => [
      difficulty,
      { first: 999, second: 999, third: 999 },
    ]),
  );
  await call("saveWeplayPolicy", { policy: changed }, "teacher");
  for (const word of [...active.words].sort((a, b) => a.spawnAtMs - b.spawnAtMs)) {
    now = active.startsAtMs + word.spawnAtMs + 101;
    const data = {
      sessionId: active.id,
      eventId: `event-${word.id}`,
      wordId: word.id,
      answer: word.text,
    };
    const responses = await Promise.all([
      call("submitWeplayAnswer", data),
      call("submitWeplayAnswer", data),
    ]);
    assert.equal(responses[0].accepted, true);
    assert.equal(responses[1].accepted, true);
    const duplicate = await call("submitWeplayAnswer", {
      ...data,
      eventId: `other-${word.id}`,
    });
    assert.equal(duplicate.accepted, false);
  }
  now = active.endsAtMs + 1000;
  const results = await Promise.all([
    call("finishWeplayGame", { sessionId: active.id }),
    call("finishWeplayGame", { sessionId: active.id }),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].correctCount, 60);
  assert.equal(results[0].rewardCorrectCount, 20);
  assert.equal(results[0].battle.specialCount, 2);
  assert.equal(results[0].reward, 5);
  assert.equal(results[0].cost, 2);
  assert.equal(results[0].netWis, 3);
  assert.equal(db.data.get(`${prefix}/point_wallets/student-a`).balance, 33);
  assert.equal(
    [...db.data.keys()].filter((key) =>
      key.includes("/point_transactions/weplay_reward_"),
    ).length,
    1,
  );
  const period = [...db.data.entries()].find(([key]) =>
    /^years\/2026\/semesters\/2\/weplay_periods\/[^/]+$/.test(key),
  )[1];
  now = period.endsAtMs + core.PERIOD_SETTLEMENT_DELAY_MS + 1000;
  await Promise.all([
    api.settleWeplayOnSchedule(),
    api.settleWeplayOnSchedule(),
  ]);
  await api.settleWeplayOnSchedule();
  assert.equal(
    db.data.get(`${prefix}/point_wallets/student-a`).balance,
    43,
    "Existing period keeps its original first-place award",
  );
  assert.equal(
    [...db.data.keys()].filter((key) =>
      key.includes("/point_transactions/weplay_rank_reward_"),
    ).length,
    1,
  );
  checks.push(
    "Duplicate events/word submissions and finalization; 60 normal correct + 2 specials normalize to 20 reward units; in-flight policy snapshot; concurrent scheduled ranking award exactly once",
  );

  now = Date.parse("2026-09-29T01:00:00Z");
  ({ db, api, call } = setup());
  db.data.get(`${prefix}/point_wallets/student-a`).balance = 1;
  await rejectCode(
    call("startWeplayGame", { mode: "challenge", requestKey: "poor" }),
    "failed-precondition",
  );
  assert.equal(db.data.get(`${prefix}/point_wallets/student-a`).balance, 1);
  const practice = await call("startWeplayGame", {
    mode: "practice",
    requestKey: "practice",
  });
  now = practice.endsAtMs + 1000;
  const result = await call("finishWeplayGame", { sessionId: practice.id });
  assert.equal(result.netWis, 0);
  assert.equal(db.data.get(`${prefix}/point_wallets/student-a`).balance, 1);
  assert.equal(
    [...db.data.keys()].filter((key) => key.includes("/point_transactions/"))
      .length,
    0,
  );
  db.data.get(`${prefix}/weplay_policies/current`).dailyChallengeLimit = 0;
  await rejectCode(
    call("startWeplayGame", { mode: "challenge", requestKey: "daily" }),
    "resource-exhausted",
  );
  checks.push(
    "Insufficient balance causes no mutation; practice stays available with no ledger change; daily limit enforced",
  );

  now = Date.parse("2026-09-29T01:00:00Z");
  ({ db, api, call } = setup());
  const deleted = await call("startWeplayGame", {
    mode: "challenge",
    requestKey: "deleted",
  });
  const saved = db.data.get(`${prefix}/weplay_sessions/${deleted.id}`);
  saved.acceptedWordIds = saved.words.map((word) => word.id);
  saved.acceptedEvents = saved.words.map((word) => ({ wordId: word.id, elapsedMs: word.spawnAtMs + 500 }));
  db.data.delete("users/student-a");
  db.data.delete(`${prefix}/point_wallets/student-a`);
  now = deleted.endsAtMs + 10000;
  await api.settleWeplayOnSchedule();
  assert.equal(
    db.data.has(`${prefix}/point_wallets/student-a`),
    false,
    "Scheduled settlement cannot resurrect a deleted student's wallet",
  );
  assert.equal(
    db.data.has(`${prefix}/weplay_players/student-a/records/${deleted.id}`),
    false,
  );
  assert.equal(
    db.data.has(`${prefix}/point_transactions/weplay_reward_${deleted.id}`),
    false,
  );
  assert.equal(
    [...db.data.entries()].some(
      ([key, value]) => key.includes("/entries/") && value.uid === "student-a",
    ),
    false,
  );
  checks.push(
    "Deleted student: scheduled settlement does not restore wallet, reward, private record, or ranking entry",
  );

  now = Date.parse("2026-09-29T01:00:00Z");
  ({ db, api, call } = setup());
  for (const [uid, correct] of [
    ["student-a", 3],
    ["student-b", 2],
    ["student-c", 1],
    ["student-d", 1],
  ])
    await play(call, uid, `rank-${uid}`, correct);
  await play(call, "student-a", "rank-student-a-mild", 1, "mild");
  await play(call, "student-a", "rank-student-a-spicy", 1, "spicy");
  const finalPeriod = [...db.data.entries()].find(([key]) =>
    /^years\/2026\/semesters\/2\/weplay_periods\/[^/]+$/.test(key),
  )[1];
  now = finalPeriod.endsAtMs + core.PERIOD_SETTLEMENT_DELAY_MS + 1000;
  await api.settleWeplayOnSchedule();
  await api.settleWeplayOnSchedule();
  for (const [uid, amount] of [
    ["student-a", 26],
    ["student-b", 5],
    ["student-c", 3],
    ["student-d", 10],
  ])
    assert.equal(
      db.data.get(`${prefix}/point_wallets/${uid}`).balance,
      28 + amount,
    );
  assert.equal(
    [...db.data.keys()].filter((key) =>
      key.includes("/point_transactions/weplay_rank_reward_"),
    ).length,
    6,
  );
  checks.push(
    "Per-class and per-difficulty final awards: 10/5/3; same player receives independent mild/medium/spicy awards; other class stays isolated; repeated scheduler no duplicate",
  );

  now = Date.parse("2026-09-29T01:00:00Z");
  ({ db, api, call } = setup());
  const naval = await call("startWeplayGame", { mode: "challenge", requestKey: "early-defeat", difficulty: "spicy" });
  const special = naval.words.find((word) => word.kind === "special");
  now = naval.startsAtMs + special.spawnAtMs + 5000;
  const expiredSpecial = await call("submitWeplayAnswer", { sessionId: naval.id, wordId: special.id, eventId: "late-special", answer: special.text });
  assert.equal(expiredSpecial.reason, "expired");
  assert.equal(expiredSpecial.battle.specialCount, 0);
  const defeat = simulateWeplayBattle(naval, 90000).defeatAtMs;
  now = naval.startsAtMs + defeat - 1;
  await rejectCode(call("finishWeplayGame", { sessionId: naval.id }), "failed-precondition");
  now += 1;
  const deadWord = naval.words.find((word) => word.kind === "normal" && word.spawnAtMs <= defeat && word.spawnAtMs + word.fallDurationMs > defeat);
  const defeatedAnswer = await call("submitWeplayAnswer", { sessionId: naval.id, wordId: deadWord.id, eventId: "after-defeat", answer: deadWord.text });
  assert.equal(defeatedAnswer.reason, "defeated");
  const early = await call("finishWeplayGame", { sessionId: naval.id });
  assert.equal(early.battle.outcome, "defeat");
  assert.equal(early.finishedAtMs, naval.startsAtMs + defeat);
  assert.equal(early.correctCount, 0);
  assert.equal(early.reward, 0);
  assert.deepEqual(await call("finishWeplayGame", { sessionId: naval.id }), early);
  assert.equal(db.data.get(`${prefix}/point_wallets/student-a`).balance, 28);
  checks.push("Special expires at exactly five seconds; early finish denied until authoritative defeat; post-defeat hits denied; repeated defeat settlement charges once");

  now = Date.parse("2026-09-29T01:00:00Z");
  ({ db, api, call } = setup());
  const settings = clone(core.DEFAULT_GAME_SETTINGS);
  for (const difficulty of Object.values(settings.difficulties)) difficulty.durationSeconds = 60;
  db.data.set(`${prefix}/weplay_games/history-rain`, settings);
  const legacyId = "legacy-rain-session";
  const legacyPeriod = { id: "period_legacy", ...core.periodBounds(now, "weekly"), rankingPeriod: "weekly", rankingRewards: clone(core.DEFAULT_POLICY.rankingRewards), policyVersion: 0, difficulties: clone(settings.difficulties), status: "open" };
  db.data.set(`${prefix}/weplay_periods/${legacyPeriod.id}`, clone(legacyPeriod));
  db.data.set(`${prefix}/weplay_meta/current`, { periodId: legacyPeriod.id });
  db.data.set(`weplay_period_queue/legacy`, { ...scope, periodId: legacyPeriod.id, dueAtMs: legacyPeriod.endsAtMs + core.PERIOD_SETTLEMENT_DELAY_MS });
  const legacyWords = core.buildWords([{ text: "고려" }, { text: "신라" }, { text: "백제" }], "legacy").slice(0, 20).map(({ kind, ...word }) => word);
  const legacy = { id: legacyId, uid: "student-a", mode: "challenge", difficulty: "medium", status: "active", startsAtMs: now - 55000, endsAtMs: now + 5000, words: legacyWords, acceptedWordIds: legacyWords.map((word) => word.id), answerEvents: {}, policy: clone(core.DEFAULT_POLICY), difficultySettings: clone(settings.difficulties.medium), periodId: legacyPeriod.id, classKey: "2-1", studentLabel: "1번 검○", result: null };
  db.data.set(`${prefix}/weplay_sessions/${legacyId}`, clone(legacy));
  db.data.set(`${prefix}/weplay_players/student-a`, { activeSessionId: legacyId });
  db.data.get(`${prefix}/point_wallets/student-a`).balance = 28;
  const migratedLobby = await call("getWeplayLobby");
  assert.equal(migratedLobby.difficulties.medium.durationSeconds, 90);
  assert.equal(migratedLobby.challengeDifficulties.medium.durationSeconds, 90);
  assert.equal(migratedLobby.activeSession.endsAtMs, legacy.endsAtMs);
  assert.equal(migratedLobby.activeSession.difficultySettings.durationSeconds, 60);
  assert.equal(migratedLobby.activeSession.battleVersion, undefined);
  assert.match(migratedLobby.period.id, /_naval_v1$/);
  assert.notEqual(migratedLobby.period.id, legacyPeriod.id);
  assert.deepEqual(db.data.get(`${prefix}/weplay_periods/${legacyPeriod.id}`), legacyPeriod);
  assert(db.data.has("weplay_period_queue/legacy"));
  await rejectCode(call("finishWeplayGame", { sessionId: legacyId }), "failed-precondition");
  now = legacy.endsAtMs + 1;
  const legacyResult = await call("finishWeplayGame", { sessionId: legacyId });
  assert.equal(legacyResult.battleVersion, undefined);
  assert.equal(legacyResult.correctCount, 20);
  assert.equal(legacyResult.totalWords, 20);
  assert.equal(legacyResult.score, 2000);
  assert.equal(legacyResult.reward, 5);
  assert.equal(db.data.get(`${prefix}/point_wallets/student-a`).balance, 33);
  assert([...db.data.keys()].some((key) => key.startsWith(`${prefix}/weplay_periods/${legacyPeriod.id}/entries/`)));
  assert(![...db.data.keys()].some((key) => key.startsWith(`${prefix}/weplay_periods/${migratedLobby.period.id}/entries/`)));
  checks.push("Legacy active 60-second session keeps its duration/20-word payout/old ranking; stored settings migrate to90; naval periods isolate scores and retain promised old podium awards");

  now = Date.parse("2026-09-29T01:00:00Z");
  ({ db, api, call } = setup());
  const onlySpecial = await call("startWeplayGame", { mode: "challenge", requestKey: "special-only", difficulty: "mild" });
  const tactic = onlySpecial.words.find((word) => word.kind === "special");
  now = onlySpecial.startsAtMs + tactic.spawnAtMs + 4000;
  const tacticResponse = await call("submitWeplayAnswer", { sessionId: onlySpecial.id, eventId: "special-only-answer", wordId: tactic.id, answer: tactic.text });
  assert.equal(tacticResponse.accepted, true);
  assert.equal(tacticResponse.correctCount, 0);
  assert.equal(tacticResponse.acceptedEvents.length, 1);
  const reloaded = await call("getWeplayLobby");
  assert.deepEqual(reloaded.activeSession.acceptedEvents, tacticResponse.acceptedEvents);
  now = onlySpecial.endsAtMs + 1;
  const specialResult = await call("finishWeplayGame", { sessionId: onlySpecial.id });
  assert.equal(specialResult.rewardCorrectCount, 0);
  assert.equal(specialResult.reward, 0);
  assert.equal(specialResult.score, 500);
  assert([...db.data.values()].some((value) => value.sessionId === onlySpecial.id && value.score === 500 && value.achievedAtMs));
  checks.push("Special succeeds at four seconds; reload preserves server-accepted event timestamps; special-only damage scores enter rankings without inflating normal-word rewards");

  now = Date.parse("2026-09-29T01:00:00Z");
  ({ db, api, call } = setup());
  const exitGame = await call("startWeplayGame", { mode: "challenge", requestKey: "voluntary-exit" });
  for (const word of exitGame.words.filter((word) => word.kind === "normal").slice(0, 30)) {
    now = exitGame.startsAtMs + word.spawnAtMs + 200;
    assert.equal((await call("submitWeplayAnswer", { sessionId: exitGame.id, eventId: `exit-hit-${word.id}`, wordId: word.id, answer: word.text })).accepted, true);
  }
  await rejectCode(call("finishWeplayGame", { sessionId: exitGame.id }), "failed-precondition");
  await rejectCode(call("finishWeplayGame", { sessionId: exitGame.id, exitEarly: false }), "failed-precondition");
  await rejectCode(call("finishWeplayGame", { sessionId: exitGame.id, exitEarly: "true" }), "invalid-argument");
  await rejectCode(call("finishWeplayGame", { sessionId: exitGame.id, exitEarly: true }, "student-b"), "permission-denied");
  const exitAtMs = now;
  const exits = await Promise.all(Array.from({ length: 5 }, () => call("finishWeplayGame", { sessionId: exitGame.id, exitEarly: true })));
  exits.forEach((item) => assert.deepEqual(item, exits[0]));
  const exited = exits[0];
  assert.equal(exited.endedEarly, true);
  assert.equal(exited.battle.outcome, "active", "Voluntary exit must not claim victory");
  assert.equal(exited.finishedAtMs, exitAtMs);
  assert.equal(exited.correctCount, 30);
  assert.equal(exited.totalWords, 60);
  assert.equal(exited.rewardCorrectCount, 10);
  assert.equal(exited.reward, 1);
  assert.equal(exited.cost, 2);
  assert.equal(db.data.get(`${prefix}/point_wallets/student-a`).balance, 29);
  assert.equal(db.data.get(`${prefix}/weplay_players/student-a`).challengeUsed, 1);
  assert.equal(db.data.get(`${prefix}/weplay_players/student-a`).activeSessionId, null);
  assert.equal(db.data.get(`${prefix}/weplay_sessions/${exitGame.id}`).endsAtMs, exitGame.endsAtMs);
  assert.equal(db.data.has(`weplay_session_queue/${exitGame.id}`), false);
  assert.equal([...db.data.keys()].filter((key) => key.includes("/point_transactions/weplay_reward_")).length, 1);
  assert.equal([...db.data.values()].find((entry) => entry.achievedAtMs && entry.sessionId === exitGame.id).achievedAtMs, exitAtMs);
  now = exitGame.endsAtMs + 1000;
  assert.deepEqual(await call("finishWeplayGame", { sessionId: exitGame.id }), exited);
  await api.settleWeplayOnSchedule();
  assert.equal(db.data.get(`${prefix}/point_wallets/student-a`).balance, 29);
  checks.push("Explicit early exit only: owner checked, full 60-word reward denominator and original end time preserved, actual finish timestamp, fee/daily count kept, duplicate/scheduled settlement pays once");

  for (const answerFirst of [true, false]) {
    now = Date.parse("2026-09-29T01:00:00Z");
    ({ db, api, call } = setup());
    const racing = await call("startWeplayGame", { mode: "practice", requestKey: `exit-answer-race-${answerFirst}` });
    const word = racing.words[0];
    now = racing.startsAtMs + 500;
    const answer = () => call("submitWeplayAnswer", { sessionId: racing.id, eventId: "racing-answer", wordId: word.id, answer: word.text });
    const finish = () => call("finishWeplayGame", { sessionId: racing.id, exitEarly: true });
    const outputs = await Promise.all(answerFirst ? [answer(), finish()] : [finish(), answer()]);
    const verdict = outputs[answerFirst ? 0 : 1];
    const closed = outputs[answerFirst ? 1 : 0];
    assert.equal(closed.correctCount, verdict.accepted ? 1 : 0);
    assert.equal(closed.netWis, 0);
    assert.equal(closed.endedEarly, true);
    assert.equal(db.data.get(`${prefix}/weplay_sessions/${racing.id}`).acceptedWordIds.length, closed.correctCount);
    assert.deepEqual(await finish(), closed);
    assert.equal((await answer()).accepted, verdict.accepted, "A repeated event keeps its original verdict without reopening the game");
    assert.equal(db.data.get(`${prefix}/point_wallets/student-a`).balance, 30);
  }
  checks.push("Concurrent answer/early-finish orders serialize: result matches committed accepted events, practice remains free, retries never reopen or mutate a settled session");
  for (const check of checks) console.log(`PASS ${check}`);
} finally {
  Date.now = oldNow;
  const evidence = path.join(
    root,
    ".superloopy/sessions/weplay-20260929/evidence",
  );
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(
    path.join(evidence, "server-results.json"),
    JSON.stringify(
      {
        checks,
        limitation:
          "In-memory serialized transactions; no live Firebase writes. Existing injected authentication/point helpers are controlled fixtures.",
      },
      null,
      2,
    ),
  );
}
