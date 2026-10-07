const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  DEFAULT_POLICY, TOTAL_WORDS, GAME_DURATION_MS, START_DELAY_MS, PERIOD_SETTLEMENT_DELAY_MS, DIFFICULTIES, FALL_DURATIONS, normalizeAnswer,
  validatePolicy, effectiveLessons, extractLessonWords, buildWords,
  assessAnswer, gameReward, periodBounds, compareEntries,
  DEFAULT_GAME_SETTINGS, DEFAULT_DIFFICULTY_SETTINGS, MAX_CATALOG_WORD_LENGTH, validateGameSettings, readGameSettings, filterGameLessons, uniqueWordCount, gameCatalog, validateDifficultySettings,
} = require('../weplayCore');

const policy = () => structuredClone(DEFAULT_POLICY);
const catalog = () => extractLessonWords([{ unitId: 'unit1', title: '고대 국가', contentHtml: '<p>[고조선]과 [삼국 시대], [통일 신라]</p>', worksheetBlanks: [{ answer: '고려' }] }]);

test('policy rejects invalid money, fractional limits, overlapping/missing result thresholds', () => {
  assert.equal(validatePolicy(policy()).challengeCost, 2);
  for (const value of [-1, 0.5, NaN, Infinity, 10001, '2', null]) {
    assert.throws(() => validatePolicy({ ...policy(), challengeCost: value }));
  }
  assert.throws(() => validatePolicy({ ...policy(), dailyChallengeLimit: 21 }));
  assert.throws(() => validatePolicy({ ...policy(), rankingRewards: { ...policy().rankingRewards, mild: { first: 1, second: 2, third: -1 } } }));
  assert.throws(() => validatePolicy({ ...policy(), resultRewards: [{ minCorrect: 1, amount: 0 }] }));
  assert.throws(() => validatePolicy({ ...policy(), resultRewards: [{ minCorrect: 0, amount: 0 }, { minCorrect: 0, amount: 1 }] }));
  assert.equal(validatePolicy({ ...policy(), challengeCost: 0, dailyChallengeLimit: 0 }).dailyChallengeLimit, 0);
});

test('latest semester hidden lesson shadows the legacy public lesson', () => {
  const items = effectiveLessons([
    { unitId: 'a', updatedAt: { seconds: 2 }, isVisibleToStudents: false },
    { unitId: 'a', updatedAt: { seconds: 1 }, isVisibleToStudents: true },
    { unitId: 'b', isVisibleToStudents: true },
  ], [{ unitId: 'a', isVisibleToStudents: true }, { unitId: 'c' }]);
  assert.deepEqual(items.map((item) => item.unitId), ['b', 'c']);
});

test('extracts teacher HTML/PDF blank answers, deduplicates, excludes footnotes and oversized prose', () => {
  const words = extractLessonWords([{ unitId: 'u', title: '제목', contentHtml: '<p title="[숨은속성]">[고조선] [fn:ref] [고조선] [삼국&nbsp;시대]</p><script>[몰래]</script>', worksheetPageImages: [{ page: 1, imageUrl: 'https://example.test/page.jpg' }], worksheetBlanks: [{ answer: '한글', page: 1, widthRatio: 10, heightRatio: 10 }, { answer: '가'.repeat(MAX_CATALOG_WORD_LENGTH + 1), page: 1, widthRatio: 10, heightRatio: 10 }, { answer: '삭제된페이지', page: 2, widthRatio: 10, heightRatio: 10 }, { answer: '영역없는빈칸', page: 1 }] }]);
  assert.deepEqual(words.map((word) => word.text), ['한글', '고조선', '삼국 시대']);
  assert.equal(normalizeAnswer(' ＡＢＣ\t 삼국 시대 '), 'abc삼국시대');
});

test('one 90-second battle has 20/20/20 normal words and two five-second tactics', () => {
  const allWords = buildWords(catalog(), 'class-period');
  const words = allWords.filter((word) => word.kind === 'normal');
  assert.equal(words.length, 60);
  assert.equal(TOTAL_WORDS, 20, 'Financial thresholds stay unchanged');
  assert.equal(GAME_DURATION_MS, 90000);
  assert.deepEqual([1, 2, 3].map((stage) => words.filter((word) => word.stage === stage).length), [20, 20, 20]);
  assert.deepEqual([words[0].fallDurationMs, words[20].fallDurationMs, words[40].fallDurationMs], [10000, 8000, 6000]);
  for (const word of words) assert.ok(word.spawnAtMs + word.fallDurationMs <= word.stage * 30000);
  assert.deepEqual(allWords.filter((word) => word.kind === 'special').map((word) => [word.spawnAtMs, word.fallDurationMs]), [[30000, 5000], [60000, 5000]]);
  assert.deepEqual(buildWords(catalog(), 'class-period'), allWords);
  assert.throws(() => buildWords(catalog().slice(0, 2), 'seed'));
  for (const difficulty of DIFFICULTIES) {
    const deck = buildWords(catalog(), 'same-class', difficulty).filter((word) => word.kind === 'normal');
    assert.deepEqual([deck[0].fallDurationMs, deck[20].fallDurationMs, deck[40].fallDurationMs], FALL_DURATIONS[difficulty]);
    for (const word of deck) assert.ok(word.spawnAtMs + word.fallDurationMs <= word.stage * 30000 - 1000);
  }
  assert.throws(() => buildWords(catalog(), 'seed', 'invalid'));
});

test('server receipt time and word identity prevent early, forged, expired and replayed hits', () => {
  const words = buildWords(catalog(), 'seed');
  const session = { status: 'active', startsAtMs: 100000, endsAtMs: 160000, words, acceptedWordIds: [] };
  const word = words[0];
  assert.equal(assessAnswer(session, word.id, word.text, 100050).reason, 'not_started');
  assert.equal(assessAnswer(session, word.id, word.text, 100100).accepted, true);
  assert.equal(assessAnswer(session, word.id, '잘못된 단어', 101000).reason, 'incorrect');
  assert.equal(assessAnswer(session, word.id, word.text, 110750).accepted, true);
  assert.equal(assessAnswer(session, word.id, word.text, 110751).reason, 'expired');
  assert.equal(assessAnswer({ ...session, acceptedWordIds: [word.id] }, word.id, word.text, 101000).reason, 'already_accepted');
  assert.equal(assessAnswer(session, 'word-99', word.text, 101000).reason, 'unknown_word');
  assert.equal(assessAnswer({ ...session, status: 'finished' }, word.id, word.text, 101000).reason, 'finished');
  assert.equal(assessAnswer(session, words[7].id, words[7].text, 101000).reason, 'not_started');
});

test('all twenty score boundaries settle using the snapshotted payout policy', () => {
  const expected = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 5, 5, 5];
  assert.deepEqual(expected.map((_, correct) => gameReward(policy(), correct)), expected);
  const snapshot = policy();
  const edited = policy();
  edited.resultRewards[4].amount = 9;
  assert.equal(gameReward(snapshot, 20), 5);
  assert.equal(gameReward(edited, 20), 9);
});

test('ranking periods use Korean midnight, Monday starts, and transitions do not overlap', () => {
  const weekly = periodBounds(Date.parse('2026-09-28T00:00:00+09:00'), 'weekly');
  assert.equal(weekly.startsAtMs, Date.parse('2026-09-28T00:00:00+09:00'));
  assert.equal(weekly.endsAtMs, Date.parse('2026-10-05T00:00:00+09:00'));
  const changed = periodBounds(weekly.endsAtMs, 'monthly', weekly.endsAtMs);
  assert.equal(changed.startsAtMs, weekly.endsAtMs);
  assert.equal(changed.endsAtMs, Date.parse('2026-11-01T00:00:00+09:00'));
  const leap = periodBounds(Date.parse('2028-02-29T22:00:00+09:00'), 'monthly');
  assert.equal(leap.endsAtMs, Date.parse('2028-03-01T00:00:00+09:00'));
});

test('ranking tie breaks by earlier achievement then stable uid', () => {
  const entries = [
    { uid: 'b', score: 100, achievedAtMs: 10 },
    { uid: 'a', score: 100, achievedAtMs: 10 },
    { uid: 'c', score: 100, achievedAtMs: 1 },
    { uid: 'd', score: 200, achievedAtMs: 99 },
  ];
  assert.deepEqual(entries.sort(compareEntries).map((entry) => entry.uid), ['d', 'c', 'a', 'b']);
});

test('game settings validate student access and canonical selected unit IDs', () => {
  assert.deepEqual(readGameSettings(null), DEFAULT_GAME_SETTINGS);
  const { version, ...defaults } = DEFAULT_GAME_SETTINGS;
  assert.deepEqual(validateGameSettings({ enabled: true, sourceMode: 'selected', unitIds: ['b', ' a ', 'b'] }), { ...defaults, sourceMode: 'selected', unitIds: ['a', 'b'] });
  assert.deepEqual(validateGameSettings({ enabled: false, sourceMode: 'selected', unitIds: [] }).unitIds, []);
  assert.deepEqual(validateGameSettings({ enabled: false, sourceMode: 'all', unitIds: ['deleted-unit'] }).unitIds, []);
  for (const invalid of [null, { enabled: 'true', sourceMode: 'all', unitIds: [] }, { enabled: true, sourceMode: 'unknown', unitIds: [] }, { enabled: true, sourceMode: 'selected', unitIds: [''] }, { enabled: true, sourceMode: 'selected', unitIds: ['a/b'] }, { enabled: true, sourceMode: 'all', unitIds: Array(201).fill('a') }]) {
    assert.throws(() => validateGameSettings(invalid));
  }
  assert.throws(() => readGameSettings({ enabled: true, sourceMode: 'all', unitIds: [], version: -1 }));
});

test('legacy manual words remain readable but never enter the blank-only catalog', () => {
  const settings = validateGameSettings({ ...DEFAULT_GAME_SETTINGS, customWords: ['삼국 시대', '삼국시대', 'ABC', '고려'], excludedWords: [' ＡＢＣ ', '삼국 시대'] });
  assert.deepEqual(settings.customWords, ['삼국 시대', 'ABC', '고려']);
  assert.deepEqual(settings.excludedWords, ['abc', '삼국시대']);
  const lessons = effectiveLessons([{ unitId: 'public', contentHtml: '[고조선] [삼국 시대]' }, { unitId: 'hidden', contentHtml: '[비밀]', isVisibleToStudents: false }], []);
  assert.deepEqual(gameCatalog(lessons, settings).map((word) => word.text), ['고조선']);
  for (const customWords of [[''], ['<b>안녕</b>'], ['가'.repeat(MAX_CATALOG_WORD_LENGTH + 1)], Array(1001).fill('고려'), [123]]) assert.throws(() => validateGameSettings({ ...DEFAULT_GAME_SETTINGS, customWords }));
  assert.deepEqual(readGameSettings({ enabled: true, sourceMode: 'all', unitIds: [], version: 3 }).difficulties, DEFAULT_DIFFICULTY_SETTINGS);
});

test('configured 90/95/180 second games preserve stage bounds, word length filtering, and strict acceleration', () => {
  assert.ok(PERIOD_SETTLEMENT_DELAY_MS > 180000 + START_DELAY_MS + 5000, 'Ranking freeze must follow even a maximum duration session started at the period boundary.');
  const words = ['가', '가나', '가나다', '가나다라', '가나다라마'].map((text) => ({ text }));
  for (const [durationSeconds, fallSeconds] of [[90, [5, 4, 3]], [95, [19, 12, 6]], [180, [30, 20, 10]]]) {
    const config = { durationSeconds, fallSeconds, minWordLength: 2, maxWordLength: 4 };
    const deck = buildWords(words, 'seed', 'mild', config).filter((word) => word.kind === 'normal');
    assert.equal(deck.length, Math.round(durationSeconds * 2 / 3));
    assert.ok(deck.every((word) => word.text.length >= 2 && word.text.length <= 4));
    for (const word of deck) assert.ok(word.spawnAtMs + word.fallDurationMs <= word.stage * durationSeconds * 1000 / 3 - 999);
    assert.deepEqual([1, 2, 3].map((stage) => deck.find((word) => word.stage === stage).fallDurationMs), fallSeconds.map((seconds) => seconds * 1000));
  }
  for (const patch of [{ durationSeconds: 89 }, { durationSeconds: 181 }, { durationSeconds: 90.5 }, { fallSeconds: [10, 10, 8] }, { fallSeconds: [8, 10, 6] }, { fallSeconds: [19, 10, 8] }, { minWordLength: 4, maxWordLength: 3 }]) assert.throws(() => validateDifficultySettings({ ...DEFAULT_DIFFICULTY_SETTINGS.mild, ...patch }));
  assert.throws(() => buildWords(words, 'seed', 'mild', { ...DEFAULT_DIFFICULTY_SETTINGS.mild, minWordLength: 4 }));
});

test('teacher preview retains hidden scoped lessons while student filtering never revives legacy answers', () => {
  const scoped = [{ unitId: 'private', isVisibleToStudents: false, contentHtml: '[비공개]' }, { unitId: 'public', contentHtml: '[공개 정답]' }];
  const legacy = [{ unitId: 'private', contentHtml: '[옛 정답]' }];
  const studentLessons = effectiveLessons(scoped, legacy);
  const teacherLessons = effectiveLessons(scoped, legacy, { includeHidden: true });
  assert.deepEqual(studentLessons.map((lesson) => lesson.unitId), ['public']);
  assert.equal(teacherLessons.find((lesson) => lesson.unitId === 'private').contentHtml, '[비공개]');
  const settings = { enabled: true, sourceMode: 'selected', unitIds: ['private'] };
  assert.deepEqual(filterGameLessons(studentLessons, settings), []);
  assert.deepEqual(filterGameLessons(teacherLessons, settings).map((lesson) => lesson.unitId), ['private']);
  assert.equal(uniqueWordCount([{ text: '공개 정답' }, { text: '공개정답' }]), 1);
});

test('OCR and plain lesson text never become answers, even when OCR contains brackets or known historical terms', () => {
  const lesson = {
    unitId: 'worksheet', title: '조선의 과학', contentHtml: '<p>조선의 과학과 천상열차분야지도 이유의 강원도황해도</p>',
    worksheetPageImages: [{ page: 1, imageUrl: 'page.jpg' }],
    worksheetTextRegions: [
      { page: 1, width: 300, height: 24, label: '이유의 강원도황해도 [천상열차분야지도] [훈민정음 해례본]' },
      { page: 1, width: 300, height: 24, label: '혼일강리역대국도지도 세종堺 이름3 관계1.Westory' },
    ],
  };
  assert.deepEqual(extractLessonWords([lesson]), []);
  const explicit = {
    ...lesson, contentHtml: `${lesson.contentHtml}<p>[이순신]과 [거북선]</p>`,
    worksheetBlanks: [{ page: 1, widthRatio: 10, heightRatio: 10, answer: '천상열차분야지도' }],
  };
  assert.deepEqual(extractLessonWords([explicit]).map(word => word.text), ['천상열차분야지도', '이순신', '거북선']);
  assert.ok(extractLessonWords([explicit]).every(word => word.unitId === 'worksheet' && word.lessonTitle === '조선의 과학'));
});

test('blank catalog obeys current semester, selected lessons, hidden/deleted lessons and exclusions', () => {
  const lesson = (unitId, words, extra = {}) => ({ unitId, contentHtml: words.map(word => `[${word}]`).join(' '), ...extra });
  const scoped = [lesson('public', ['천상열차분야지도', '직지심체요절', '세종대왕']), lesson('private', ['비공개정답'], { isVisibleToStudents: false }), lesson('deleted', ['삭제자료정답'], { deletedAt: '2026-10-07' }), lesson('other', ['선택하지않은정답'])];
  const legacy = [lesson('private', ['과거공개정답']), lesson('legacy', ['구학기보충정답'])];
  const visible = effectiveLessons(scoped, legacy);
  const settings = validateGameSettings({ ...DEFAULT_GAME_SETTINGS, sourceMode: 'selected', unitIds: ['public'], excludedWords: ['천상열차분야지도'], customWords: ['빈칸외수동단어'] });
  assert.deepEqual(gameCatalog(visible, settings).map(word => word.text), ['직지심체요절', '세종대왕']);
  assert.ok(!gameCatalog(visible, DEFAULT_GAME_SETTINGS).some(word => /비공개|과거공개|삭제자료/.test(word.text)));
  assert.ok(gameCatalog(visible, DEFAULT_GAME_SETTINGS).some(word => word.text === '구학기보충정답'));
});

test('authored blank answers retain their exact historical spelling and punctuation without OCR cleanup', () => {
  const lesson = {
    unitId: 'explicit', contentHtml: '[3·1운동] [6·25전쟁] [四] [UN 헌장] [발전.Ⅳ]',
    worksheetPageImages: [{ page: 1, imageUrl: 'page.jpg' }],
    worksheetBlanks: [{ page: 1, widthRatio: 10, heightRatio: 10, answer: '사카이堺' }],
    worksheetTextRegions: [{ page: 1, width: 300, height: 24, label: '[인식만한단어] 十' }],
  };
  const settings = validateGameSettings({ ...DEFAULT_GAME_SETTINGS, customWords: ['별도추가단어'] });
  assert.deepEqual(gameCatalog([lesson], settings).map(word => word.text), ['사카이堺', '3·1운동', '6·25전쟁', '四', 'UN 헌장', '발전.IV']);
});

test('long blank terms remain available for specials and exclusions while normal difficulty limits stay at twelve', () => {
  const long = '대한민국임시정부수립과정과활동';
  assert.ok(Array.from(long).length > 12);
  const lesson = {unitId:'long',contentHtml:`[${long}] [천상열차분야지도] [고려] [신라] [조선]`};
  const settings = validateGameSettings({...DEFAULT_GAME_SETTINGS, customWords:[long]});
  const words = gameCatalog([lesson],settings);
  assert.ok(words.some(word=>word.text===long));
  const deck = buildWords(words,'long-source','mild');
  assert.deepEqual(new Set(deck.filter(word=>word.kind==='special').map(word=>word.text)), new Set([long,'천상열차분야지도']));
  assert.ok(deck.filter(word=>word.kind==='normal').every(word=>Array.from(normalizeAnswer(word.text)).length<=12));
  assert.ok(!gameCatalog([lesson], validateGameSettings({...settings,excludedWords:[long]})).some(word=>word.text===long));
});

test('specials use distinct seeded blanks and fill remaining slots only with actual shorter blanks', () => {
  const short = catalog();
  const long = ['혼일강리역대국도지도','천상열차분야지도','훈민정음해례본'].map(text=>({text,unitId:'source'}));
  const pick = (pool,seed,options={}) => buildWords(pool,seed,'mild',DEFAULT_DIFFICULTY_SETTINGS.mild,options).filter(word=>word.kind==='special');
  for(let seed=0;seed<30;seed++) {
    const selected=pick([...short,...long],String(seed));
    assert.equal(new Set(selected.map(word=>normalizeAnswer(word.text))).size,2);
    assert.ok(selected.every(word=>word.unitId==='source'));
    assert.deepEqual(pick([...short,...long],String(seed)),selected);
    const single=pick([...short,long[0]],String(seed));
    assert.equal(single[0].text,long[0].text);
    assert.equal(new Set(single.map(word=>normalizeAnswer(word.text))).size,2);
    assert.equal(single[1].unitId,'unit1');
    assert.ok(short.some(word=>word.text===single[1].text));
  }
  const excluded=pick([...short,...long],'excluded',{excludedWords:['천상 열차 분야 지도','혼일강리역대국도지도']});
  assert.equal(excluded[0].text,'훈민정음해례본');
  assert.ok(excluded.every(word=>!['천상열차분야지도','혼일강리역대국도지도'].includes(word.text)));
});

test('when no long blank exists, tactics use longest available blanks without injecting historical fallback words', () => {
  const pool = catalog();
  const permitted = new Set(pool.map(word => word.text));
  for (const difficulty of DIFFICULTIES) {
    for (let seed = 0; seed < 30; seed++) {
      const deck = buildWords(pool, String(seed), difficulty);
      assert.ok(deck.every(word => permitted.has(word.text)));
      const specials = deck.filter(word => word.kind === 'special');
      assert.equal(new Set(specials.map(word => word.text)).size, 2);
      assert.deepEqual(new Set(specials.map(word => word.text)), new Set(['삼국 시대', '통일 신라']));
      assert.ok(specials.every(word => word.unitId === 'unit1'));
    }
  }
  const single = buildWords(pool, 'one', 'mild', DEFAULT_DIFFICULTY_SETTINGS.mild, { excludedWords: ['삼국 시대', '통일 신라'] }).filter(word => word.kind === 'special');
  assert.deepEqual(single.map(word => word.text), ['고조선']);
  assert.equal(buildWords(pool, 'none', 'mild', DEFAULT_DIFFICULTY_SETTINGS.mild, { excludedWords: [...permitted] }).filter(word => word.kind === 'special').length, 0);
});
