const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const core = require('../weplayCore');
const { simulateWeplayBattle, WEPLAY_BATTLE_CONFIG } = require('../weplayBattle');
const clientPath = path.resolve(__dirname, '../../src/lib/weplayBattle.ts');
const compiled = new Module(clientPath, module);
compiled._compile(ts.transpileModule(fs.readFileSync(clientPath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, clientPath);
const client = compiled.exports.simulateWeplayBattle;
const loadTs = (relative, imports, clock = {}) => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/lib', relative), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('require', 'exports', 'performance', output)((name) => {
    assert.ok(Object.prototype.hasOwnProperty.call(imports, name), `Unexpected dependency: ${name}`);
    return imports[name];
  }, exports, clock);
  return exports;
};
const catalog = ['고려', '신라', '백제', '혼일강리역대국도지도'].map((text) => ({ text, unitId: 'lesson', context: '', lessonTitle: '역사' }));
const sessionFor = (difficulty = 'medium', durationSeconds = 90) => {
  const difficultySettings = { ...core.DEFAULT_DIFFICULTY_SETTINGS[difficulty], durationSeconds };
  return { difficulty, difficultySettings, startsAtMs: 100000, endsAtMs: 100000 + durationSeconds * 1000, battleVersion: 1, status: 'active', acceptedEvents: [], acceptedWordIds: [], words: core.buildWords(catalog, 'battle-test', difficulty, difficultySettings) };
};

test('server and client replay agree across every phase, shuffled events, duplicates and all durations', () => {
  for (const difficulty of core.DIFFICULTIES) for (const duration of [90, 95, 100, 120, 180]) {
    const session = sessionFor(difficulty, duration);
    const events = session.words.map((word) => ({ wordId: word.id, elapsedMs: word.spawnAtMs + 500 }));
    const shuffled = [...events].reverse().concat(events[0], { wordId: 'forged', elapsedMs: 100 });
    for (const time of [-3000, 0, 7999, 8000, duration * 1000 / 3, duration * 2000 / 3, duration * 1000]) {
      assert.deepEqual(client(session, time, shuffled), simulateWeplayBattle(session, time, shuffled));
      assert.deepEqual(simulateWeplayBattle(session, time, shuffled), simulateWeplayBattle(session, time, events));
    }
  }
});

test('two/three/four correct normal words charge one cannon and deal exactly twelve damage', () => {
  for (const difficulty of core.DIFFICULTIES) {
    const session = sessionFor(difficulty);
    const count = WEPLAY_BATTLE_CONFIG[difficulty].ammoRequired;
    const events = session.words.slice(0, count).map((word) => ({ wordId: word.id, elapsedMs: word.spawnAtMs + 500 }));
    const before = simulateWeplayBattle(session, events.at(-1).elapsedMs, events.slice(0, -1));
    assert.equal(before.cannonShots, 0);
    assert.equal(before.ammo, count - 1);
    const after = simulateWeplayBattle(session, events.at(-1).elapsedMs, events);
    assert.equal(after.cannonShots, 1);
    assert.equal(after.ammo, 0);
    assert.equal(after.enemyHp, 88);
  }
});

test('perfect normal typing can win without specials at 90/120/180 seconds; idle play loses all defaults', () => {
  for (const difficulty of core.DIFFICULTIES) {
    const idle = simulateWeplayBattle(sessionFor(difficulty), 90000);
    assert.equal(idle.outcome, 'defeat', difficulty);
    assert.ok(idle.defeatAtMs < 90000);
    for (const duration of [90, 120, 180]) {
      const session = sessionFor(difficulty, duration);
      const events = session.words.filter((word) => word.kind === 'normal').map((word) => ({ wordId: word.id, elapsedMs: word.spawnAtMs + 500 }));
      const result = simulateWeplayBattle(session, duration * 1000, events);
      assert.equal(result.outcome, 'victory', `${difficulty}/${duration}`);
      assert.equal(result.normalCorrectCount, Math.round(duration * 2 / 3));
      assert.equal(result.rewardCorrectCount, 20);
      assert.equal(result.specialCount, 0);
    }
  }
});

test('special challenge succeeds at four seconds, expires at five seconds, and never inflates payout', () => {
  const session = sessionFor('mild');
  const word = session.words.find((item) => item.kind === 'special');
  assert.equal(word.text, '혼일강리역대국도지도');
  assert.equal(core.assessAnswer(session, word.id, word.text, session.startsAtMs + word.spawnAtMs + 4000).accepted, true);
  assert.equal(core.assessAnswer(session, word.id, word.text, session.startsAtMs + word.spawnAtMs + 4999).accepted, true);
  assert.equal(core.assessAnswer(session, word.id, word.text, session.startsAtMs + word.spawnAtMs + 5000).reason, 'expired');
  const state = simulateWeplayBattle(session, word.spawnAtMs + 1500, [{ wordId: word.id, elapsedMs: word.spawnAtMs + 1500 }]);
  assert.equal(state.specialCount, 1);
  assert.equal(state.enemyHp, 55);
  assert.equal(state.normalCorrectCount, 0);
  assert.equal(state.rewardCorrectCount, 0);
  assert.equal(state.score, 500);
  const all = session.words.map((item) => ({ wordId: item.id, elapsedMs: item.spawnAtMs + 500 }));
  assert.equal(simulateWeplayBattle(session, 90000, all).rewardCorrectCount, 20);
});

test('server and real teacher preview preserve each special snapshot window, including stored three-second games', async () => {
  // Run the actual TS preview transport with an injected monotonic clock and
  // disconnected SDK imports. No Firebase or browser network calls are possible.
  const definitions = loadTs('weplay.ts', { './firebase': {}, './semesterScope': {} });
  for (const storedWindow of [5000, 3000]) for (const offset of [2999, 3000, 4000, 4999, 5000]) {
    let clockMs = 0;
    const session = { ...sessionFor('mild'), id: 'preview-special-window', serverNowMs: 100000 };
    const word = session.words.find((item) => item.kind === 'special');
    word.fallDurationMs = storedWindow;
    const { createWeplayPreviewTransport } = loadTs('weplayPreview.ts', { './weplay': definitions, './weplayBattle': compiled.exports }, { now: () => clockMs });
    const preview = createWeplayPreviewTransport(session);
    clockMs = word.spawnAtMs + offset;
    const server = core.assessAnswer(session, word.id, word.text, session.startsAtMs + clockMs);
    const local = await preview.answer({ sessionId: session.id, wordId: word.id, answer: word.text });
    assert.equal(local.accepted, server.accepted, `${storedWindow}ms snapshot at +${offset}ms`);
    assert.equal(local.accepted, offset < storedWindow);
    assert.equal(local.battle.specialCount, offset < storedWindow ? 1 : 0);
    assert.equal(local.correctCount, 0);
  }
});

test('teacher preview early exit is explicit, locally idempotent, and keeps the original game denominator', async () => {
  const definitions = loadTs('weplay.ts', { './firebase': {}, './semesterScope': {} });
  let clockMs = 0;
  const session = { ...sessionFor('mild'), id: 'preview-exit', serverNowMs: 100000 };
  const { createWeplayPreviewTransport } = loadTs('weplayPreview.ts', { './weplay': definitions, './weplayBattle': compiled.exports }, { now: () => clockMs });
  const preview = createWeplayPreviewTransport(session);
  for (const word of session.words.filter((item) => item.kind === 'normal').slice(0, 30)) {
    clockMs = word.spawnAtMs + 200;
    assert.equal((await preview.answer({ sessionId: session.id, wordId: word.id, answer: word.text })).accepted, true);
  }
  await assert.rejects(preview.finish(), /게임이 끝난 뒤/);
  await assert.rejects(preview.finish({ exitEarly: false }), /게임이 끝난 뒤/);
  const result = await preview.finish({ exitEarly: true });
  assert.equal(result.endedEarly, true);
  assert.equal(result.battle.outcome, 'active');
  assert.equal(result.totalWords, 60);
  assert.equal(result.correctCount, 30);
  assert.equal(result.rewardCorrectCount, 10);
  assert.equal(result.finishedAtMs, session.startsAtMs + clockMs);
  assert.equal(result.netWis, 0);
  assert.equal(session.endsAtMs, 190000);
  const nextWord = session.words[30];
  clockMs = nextWord.spawnAtMs + 200;
  assert.equal((await preview.answer({ sessionId: session.id, wordId: nextWord.id, answer: nextWord.text })).accepted, false);
  clockMs = 100000;
  assert.deepEqual(await preview.finish(), result);
  assert.deepEqual(await preview.finish({ exitEarly: true }), result);
  const legacy = { ...session, id: 'legacy-preview-exit', battleVersion: undefined };
  const legacyPreview = createWeplayPreviewTransport(legacy);
  await assert.rejects(legacyPreview.finish(), /게임이 끝난 뒤/);
  assert.equal((await legacyPreview.finish({ exitEarly: true })).endedEarly, true);
});

test('defeat permanently closes combat; accepted events beyond death cannot resurrect the fleet', () => {
  const session = sessionFor('spicy');
  const defeated = simulateWeplayBattle(session, 90000);
  const laterWord = session.words.find((word) => word.spawnAtMs > defeated.defeatAtMs);
  assert.equal(core.assessAnswer(session, laterWord.id, laterWord.text, session.startsAtMs + laterWord.spawnAtMs + 100).reason, 'defeated');
  const replayed = simulateWeplayBattle(session, 90000, [{ wordId: laterWord.id, elapsedMs: laterWord.spawnAtMs + 500 }]);
  assert.equal(replayed.normalCorrectCount, 0);
  assert.equal(replayed.defeatAtMs, defeated.defeatAtMs);
});

test('stored 30/60-second settings migrate without mutation while new writes enforce ninety seconds', () => {
  for (const durationSeconds of [30, 60]) {
    const stored = { ...structuredClone(core.DEFAULT_GAME_SETTINGS), version: 9 };
    for (const config of Object.values(stored.difficulties)) config.durationSeconds = durationSeconds;
    const migrated = core.readGameSettings(stored);
    assert.equal(migrated.version, 9);
    assert.equal(migrated.difficulties.mild.durationSeconds, 90);
    assert.equal(stored.difficulties.mild.durationSeconds, durationSeconds);
    assert.throws(() => core.validateGameSettings(stored), /90~180/);
  }
  const excluded = ['혼일강리역대국도지도', '생즉사사즉생', '학익진전술을펼쳐라'];
  const words = core.buildWords(catalog.slice(0, 3), 'excluded', 'mild', core.DEFAULT_DIFFICULTY_SETTINGS.mild, { excludedWords: excluded });
  assert.equal(words.filter((word) => word.kind === 'special').length, 0);
});
