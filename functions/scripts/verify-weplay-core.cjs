const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  DEFAULT_POLICY, TOTAL_WORDS, GAME_DURATION_MS, START_DELAY_MS, PERIOD_SETTLEMENT_DELAY_MS, DIFFICULTIES, FALL_DURATIONS, normalizeAnswer,
  validatePolicy, effectiveLessons, extractLessonWords, buildWords,
  assessAnswer, gameReward, periodBounds, compareEntries,
  DEFAULT_GAME_SETTINGS, DEFAULT_DIFFICULTY_SETTINGS, MAX_CATALOG_WORD_LENGTH, SPECIAL_FALLBACK_WORDS, validateGameSettings, readGameSettings, filterGameLessons, uniqueWordCount, gameCatalog, validateDifficultySettings,
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

test('editable words normalize, deduplicate, respect exclusions and selected lesson visibility', () => {
  const settings = validateGameSettings({ ...DEFAULT_GAME_SETTINGS, customWords: ['삼국 시대', '삼국시대', 'ABC', '고려'], excludedWords: [' ＡＢＣ ', '삼국 시대'] });
  assert.deepEqual(settings.customWords, ['삼국 시대', 'ABC', '고려']);
  assert.deepEqual(settings.excludedWords, ['abc', '삼국시대']);
  const lessons = effectiveLessons([{ unitId: 'public', contentHtml: '[고조선] [삼국 시대]' }, { unitId: 'hidden', contentHtml: '[비밀]', isVisibleToStudents: false }], []);
  assert.deepEqual(gameCatalog(lessons, settings).map((word) => word.text), ['고조선', '고려']);
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

test('recognized worksheet text supplies tokens without blanks, skips removed pages/noise, and preserves known terms', () => {
  const region = (label, page = 1, extra = {}) => ({ label, page, left: 20, top: 20, width: 300, height: 24, ...extra });
  const words = extractLessonWords([{
    unitId: 'worksheet', title: '조선의 과학', worksheetPageImages: [{ page: 1, imageUrl: 'page.jpg' }], worksheetBlanks: [],
    worksheetTextRegions: [
      region('[천상열차분야지도] 혼일강리역대국도지도 [훈민정음 해례본] 1592 42 !!! 은 는 [fn:ref]'),
      region('천상열차분야지도를 훈민정음해례본'),
      region('국가 가야'), region('고려'), region('고려는'),
      region('삭제한페이지의비공개단어', 2), region('이미지없는단어', 3),
      region('영역없는단어', 1, { width: 0 }), region('높이없는단어', 1, { height: 0 }),
    ],
  }]);
  assert.deepEqual(words.map(word => word.text), ['천상열차분야지도', '혼일강리역대국도지도', '훈민정음 해례본', '국가', '가야', '고려']);
  assert.ok(words.every(word => word.unitId === 'worksheet' && word.lessonTitle === '조선의 과학'));
});

test('recognized words obey current semester, selected lesson, hidden/deleted lesson and teacher exclusion boundaries', () => {
  const lesson = (unitId, text, extra = {}) => ({unitId, worksheetPageImages:[{page:1,imageUrl:'page.jpg'}], worksheetTextRegions:[{page:1,label:text,width:200,height:20}], ...extra});
  const scoped = [lesson('public', '천상열차분야지도 직지심체요절 세종대왕'), lesson('private', '비공개인식단어', {isVisibleToStudents:false}), lesson('deleted','삭제자료단어',{deletedAt:'2026-10-07'}), lesson('other','선택하지않은자료')];
  const legacy = [lesson('private','과거공개인식단어'), lesson('legacy','구학기보충단어')];
  const visible = effectiveLessons(scoped, legacy);
  const settings = validateGameSettings({...DEFAULT_GAME_SETTINGS,sourceMode:'selected',unitIds:['public'],excludedWords:['천상열차분야지도']});
  assert.deepEqual(gameCatalog(visible, settings).map(word=>word.text), ['직지심체요절','세종대왕']);
  assert.ok(!gameCatalog(visible, DEFAULT_GAME_SETTINGS).some(word=>/비공개|과거공개|삭제자료/.test(word.text)));
  assert.ok(gameCatalog(visible, DEFAULT_GAME_SETTINGS).some(word=>word.text==='구학기보충단어'));
});

test('recognized historical terms retain internal middle dots, periods and hyphens without importing numeric dates or trailing punctuation', () => {
  const words = extractLessonWords([{
    unitId: 'modern-history', worksheetPageImages: [{page:1,imageUrl:'page.jpg'}],
    worksheetTextRegions: [{page:1,width:400,height:24,label:'3·1운동, 6·25전쟁. 4.19혁명 5-18민주화운동 4‧19혁명 한‐일의정서 한‑일협약 1592.10.1 3·1 6-25 --- ··· 고려.'}],
  }]);
  assert.deepEqual(words.map(word=>word.text), ['3·1운동','6·25전쟁','4.19혁명','5-18민주화운동','4‧19혁명','한‐일의정서','한‐일협약','고려']);
  const settings = validateGameSettings({...DEFAULT_GAME_SETTINGS,excludedWords:['3·1운동','6·25전쟁']});
  assert.ok(!gameCatalog([{unitId:'modern-history',worksheetPageImages:[{page:1,imageUrl:'page.jpg'}],worksheetTextRegions:[{page:1,width:200,height:24,label:'3·1운동 6·25전쟁 고려'}]}],settings).some(word=>word.text==='3·1운동'||word.text==='6·25전쟁'));
});

test('PDF space glyphs, merged heading numbers and template OCR are cleaned without losing history terms', () => {
  const region = (label, top = 300, extra = {}) => ({ page: 1, left: 50, top, width: 180, height: 25.6, label, ...extra });
  // Geometry and broken labels mirror the public 1348 x 953 lesson PDFs.
  const words = extractLessonWords([{
    unitId: 'public-pdf', worksheetPageImages: [{page:1,width:1348,height:953,imageUrl:'page.jpg'}],
    worksheetTextRegions: [
      region('조선의堺', 55), region('세종堺'), region('경연堺'), region('법전을堺'),
      region('발전.Ⅳ', 55), region('관계1.Westory', 63), region('pp. 116➋', 71),
      region('확립500', 75), region('번 이름3', 111), region('학년', 111), region('반', 111),
      region('우리가堺 써堺 내려가는堺 이야기', 97), region('직계제vs 6', 316),
      region('3·1운동 6·25전쟁 4.19혁명 6두품 UN OECD'),
      region('조선 세종 경연 법전 직계제'),
      region('예조 춘추관 성균관 훈민정음해례본', 831),
      region('방재석© 2026', 873), region('수업용堺 재구성堺 자료이므로堺', 890),
      region('무단堺 전재 재배포堺 금지·', 890),
    ],
  }]).map(word => word.text);
  for (const expected of ['조선','세종','경연','법전','발전','관계','확립','직계제','3·1운동','6·25전쟁','4.19혁명','6두품','UN','OECD','예조','춘추관','성균관','훈민정음해례본']) assert.ok(words.includes(expected), expected);
  for (const noise of ['조선의堺','세종堺','경연堺','법전을堺','발전.IV','IV','관계1.Westory','Westory','pp','직계제vs','vs','확립500','이름3','이름','학년','반','번','우리가','써','내려가는','이야기','방재석','수업용','재구성','자료이므로','무단','전재','재배포','금지']) assert.ok(!words.includes(noise), noise);
  assert.ok(!words.some(word => word.includes('堺')));
});

test('copyright filtering is local to confirmed footer lines and never drops a whole-page body region', () => {
  const words = extractLessonWords([{
    unitId: 'page-regions', worksheetPageImages: [{page:1,width:1348,height:953,imageUrl:'page.jpg'},{page:2,width:1348,height:953,imageUrl:'page2.jpg'}],
    worksheetTextRegions: [
      {page:1,left:0,top:0,width:1348,height:953,label:'천상열차분야지도 3·1운동 김교사© 2026 훈민정음해례본'},
      {page:1,left:50,top:873,width:200,height:25,label:'이교사© 2026'},
      {page:1,left:50,top:891,width:200,height:25,label:'재배포 금지'},
      {page:2,left:50,top:891,width:200,height:25,label:'고려대장경판'},
    ],
  }]).map(word => word.text);
  assert.deepEqual(words, ['천상열차분야지도','3·1운동','훈민정음해례본','고려대장경판']);
});

test('OCR cleanup preserves lone Hanja and explicit blank/custom words even when they resemble noisy OCR', () => {
  const lessons = [{
    unitId:'protected', contentHtml:'[발전.IV] [직계제vs]',
    worksheetPageImages:[{page:1,width:1348,height:953,imageUrl:'page.jpg'}],
    worksheetBlanks:[{page:1,widthRatio:10,heightRatio:10,answer:'세종堺'}],
    worksheetTextRegions:[
      {page:1,width:400,height:24,label:'사카이堺 [확립500] [UN 헌장]'},
      {page:1,width:400,height:24,label:'사카이堺'},
      {page:1,width:400,height:24,label:'사카이堺'},
    ],
  }];
  const settings = validateGameSettings({...DEFAULT_GAME_SETTINGS,customWords:['이름3','pp','관계1.Westory']});
  assert.deepEqual(gameCatalog(lessons,settings).map(word=>word.text), ['세종堺','발전.IV','직계제vs','사카이堺','확립500','UN 헌장','이름3','pp','관계1.Westory']);
  assert.ok(!gameCatalog(lessons,validateGameSettings({...settings,excludedWords:['세종堺','확립500']})).some(word=>['세종堺','확립500'].includes(word.text)));
});

test('OCR-only Hanja numerals are omitted while historical terms and explicitly selected numerals are preserved', () => {
  const lesson = {
    unitId:'han-numbers', worksheetPageImages:[{page:1,imageUrl:'page.jpg'}],
    worksheetTextRegions:[{page:1,width:400,height:24,label:'三 四 七 九 十一 百二十 零 〇 三國史記'}],
  };
  assert.deepEqual(extractLessonWords([lesson]).map(word=>word.text), ['三國史記']);
  const explicit = {...lesson, contentHtml:'[七]', worksheetBlanks:[{page:1,widthRatio:10,heightRatio:10,answer:'九'}],
    worksheetTextRegions:[...lesson.worksheetTextRegions,{page:1,width:200,height:24,label:'[三] [四]'}]};
  const settings = validateGameSettings({...DEFAULT_GAME_SETTINGS,customWords:['十']});
  assert.deepEqual(gameCatalog([explicit],settings).map(word=>word.text), ['九','七','三國史記','三','四','十']);
});

test('long blank/custom terms remain available for specials and exclusions while normal difficulty limits stay at twelve', () => {
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

test('specials use distinct seeded lesson terms; one source term gets a different fallback instead of repeating', () => {
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
    assert.equal(single[1].unitId,'__weplay_tactic__');
  }
  const excluded=pick([...short,...long],'excluded',{excludedWords:['천상 열차 분야 지도','혼일강리역대국도지도']});
  assert.equal(excluded[0].text,'훈민정음해례본');
  assert.ok(excluded.every(word=>!['천상열차분야지도','혼일강리역대국도지도'].includes(word.text)));
});

test('historical fallback specials rotate with the seed and all exclusions are honored without duplicate slots', () => {
  const observed = new Set();
  for(let seed=0;seed<50;seed++) {
    const specials=buildWords(catalog(),String(seed)).filter(word=>word.kind==='special');
    assert.equal(new Set(specials.map(word=>word.text)).size,2);
    specials.forEach(word=>observed.add(word.text));
  }
  assert.ok(observed.size>2);
  assert.ok(observed.has('천상열차분야지도'));
  const excludedWords=SPECIAL_FALLBACK_WORDS.filter(text=>text!=='천상열차분야지도');
  const single=buildWords(catalog(),'one','mild',DEFAULT_DIFFICULTY_SETTINGS.mild,{excludedWords}).filter(word=>word.kind==='special');
  assert.deepEqual(single.map(word=>word.text),['천상열차분야지도']);
  assert.equal(buildWords(catalog(),'none','mild',DEFAULT_DIFFICULTY_SETTINGS.mild,{excludedWords:SPECIAL_FALLBACK_WORDS}).filter(word=>word.kind==='special').length,0);
});
