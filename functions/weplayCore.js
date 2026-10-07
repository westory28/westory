const crypto = require('node:crypto');
const { simulateWeplayBattle } = require('./weplayBattle');

const TOTAL_WORDS = 20;
const GAME_DURATION_MS = 90000;
const BATTLE_NORMAL_WORDS = 60;
const START_DELAY_MS = 3000;
const ANSWER_GRACE_MS = 750;
const PERIOD_SETTLEMENT_DELAY_MS = 240000;
const DIFFICULTIES = ['mild', 'medium', 'spicy'];
const FALL_DURATIONS = { mild: [12000, 10000, 8000], medium: [10000, 8000, 6000], spicy: [8000, 6000, 4000] };
const GAME_ID = 'history-rain';
const MAX_CATALOG_WORD_LENGTH = 40;
const SPECIAL_FALLBACK_WORDS = ['혼일강리역대국도지도', '천상열차분야지도', '훈민정음해례본', '조선왕조실록', '직지심체요절', '고려대장경판', '무구정광대다라니경', '백제금동대향로'];
const OCR_STOP_WORDS = new Set(['은', '는', '이', '가', '을', '를', '의', '와', '과', '에', '에서', '에게', '으로', '로', '부터', '까지', '그리고', '그러나', '또는', '및', '등']);
const OCR_PARTICLES = ['에서는', '으로는', '에게는', '에서', '에게', '으로', '부터', '까지', '에는', '은', '는', '이', '가', '을', '를', '의', '와', '과', '에', '로', '도', '만'];
const DEFAULT_DIFFICULTY_SETTINGS = Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, {
  durationSeconds: 90, fallSeconds: FALL_DURATIONS[difficulty].map((ms) => ms / 1000), minWordLength: 1, maxWordLength: 12,
}]));
const DEFAULT_GAME_SETTINGS = { enabled: true, sourceMode: 'all', unitIds: [], excludedWords: [], customWords: [], difficulties: DEFAULT_DIFFICULTY_SETTINGS, version: 0 };
const DEFAULT_POLICY = {
  enabled: true,
  challengeCost: 2,
  dailyChallengeLimit: 3,
  resultRewards: [
    { minCorrect: 0, amount: 0 },
    { minCorrect: 10, amount: 1 },
    { minCorrect: 14, amount: 2 },
    { minCorrect: 16, amount: 3 },
    { minCorrect: 18, amount: 5 },
  ],
  rankingPeriod: 'weekly',
  rankingRewards: {
    mild: { first: 10, second: 5, third: 3 },
    medium: { first: 10, second: 5, third: 3 },
    spicy: { first: 10, second: 5, third: 3 },
  },
  version: 0,
};

const hash = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');
const normalizeAnswer = (text) => String(text || '').normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('ko-KR');
const integer = (value, min, max, name) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name}: ${min}~${max} 사이의 정수를 입력해 주세요.`);
  }
  return value;
};

function validatePolicy(input) {
  if (!input || typeof input.enabled !== 'boolean') throw new Error('도전 운영 여부를 확인해 주세요.');
  if (!['weekly', 'monthly'].includes(input.rankingPeriod)) throw new Error('랭킹 집계 기간을 확인해 주세요.');
  if (!Array.isArray(input.resultRewards) || input.resultRewards.length < 1 || input.resultRewards.length > 21) {
    throw new Error('결과별 지급 구간은 1~21개로 설정해 주세요.');
  }
  const resultRewards = input.resultRewards.map((row) => ({
    minCorrect: integer(row?.minCorrect, 0, TOTAL_WORDS, '정답 수'),
    amount: integer(row?.amount, 0, 10000, '지급액'),
  })).sort((a, b) => a.minCorrect - b.minCorrect);
  if (resultRewards[0].minCorrect !== 0 || new Set(resultRewards.map((row) => row.minCorrect)).size !== resultRewards.length) {
    throw new Error('지급 구간은 0개부터 시작하고 정답 수가 중복되지 않아야 합니다.');
  }
  return {
    enabled: input.enabled,
    challengeCost: integer(input.challengeCost, 0, 10000, '도전 비용'),
    dailyChallengeLimit: integer(input.dailyChallengeLimit, 0, 20, '일일 도전 횟수'),
    resultRewards,
    rankingPeriod: input.rankingPeriod,
    rankingRewards: Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, {
      first: integer(input.rankingRewards?.[difficulty]?.first, 0, 10000, '1위 보상'),
      second: integer(input.rankingRewards?.[difficulty]?.second, 0, 10000, '2위 보상'),
      third: integer(input.rankingRewards?.[difficulty]?.third, 0, 10000, '3위 보상'),
    }])),
  };
}

function readPolicy(data) {
  if (!data) return structuredClone(DEFAULT_POLICY);
  return { ...validatePolicy(data), version: Number(data.version || 0) };
}

function validateUnitIds(input) {
  if (!Array.isArray(input) || input.length > 200 || input.some((id) => typeof id !== 'string' || !id.trim() || id.trim().length > 128 || /[\/\u0000-\u001f]/.test(id))) {
    throw new Error('출제 자료는 200개 이내의 올바른 단원 번호로 선택해 주세요.');
  }
  return [...new Set(input.map((id) => id.trim()))].sort();
}

function validateGameSettings(input) {
  if (!input || typeof input.enabled !== 'boolean') throw new Error('학생 사용 허용 여부를 확인해 주세요.');
  if (!['all', 'selected'].includes(input.sourceMode)) throw new Error('출제 자료 범위를 확인해 주세요.');
  const unitIds = validateUnitIds(input.unitIds);
  return {
    enabled: input.enabled, sourceMode: input.sourceMode, unitIds: input.sourceMode === 'all' ? [] : unitIds,
    excludedWords: validateWordList(input.excludedWords ?? [], true), customWords: validateWordList(input.customWords ?? []),
    difficulties: validateDifficulties(input.difficulties ?? DEFAULT_DIFFICULTY_SETTINGS),
  };
}

function validateWordList(input, normalize = false) {
  if (!Array.isArray(input) || input.length > 1000) throw new Error('단어는 1,000개 이내로 등록해 주세요.');
  const unique = new Map();
  for (const raw of input) {
    if (typeof raw !== 'string') throw new Error('단어를 확인해 주세요.');
    const text = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const key = normalizeAnswer(text);
    if (!key || Array.from(text).length > MAX_CATALOG_WORD_LENGTH || !/[\p{L}\p{N}]/u.test(text) || /[<>\u0000-\u001f]/.test(text) || text.startsWith('fn:')) throw new Error(`단어는 글자나 숫자를 포함해 1~${MAX_CATALOG_WORD_LENGTH}자로 입력해 주세요.`);
    if (!unique.has(key)) unique.set(key, normalize ? key : text);
  }
  return [...unique.values()];
}

function validateDifficultySettings(input) {
  const durationSeconds = integer(input?.durationSeconds, 90, 180, '전체 제한 시간');
  if (!Array.isArray(input?.fallSeconds) || input.fallSeconds.length !== 3) throw new Error('초반·중반·후반 입력 시간을 설정해 주세요.');
  const fallSeconds = input.fallSeconds.map((seconds) => integer(seconds, 1, Math.min(30, Math.floor((durationSeconds / 3 - 1) * 0.64)), '입력 시간'));
  if (fallSeconds[0] <= fallSeconds[1] || fallSeconds[1] <= fallSeconds[2]) throw new Error('입력 시간은 초반·중반·후반 순으로 짧아져야 합니다.');
  const minWordLength = integer(input?.minWordLength, 1, 12, '최소 단어 길이');
  const maxWordLength = integer(input?.maxWordLength, 1, 12, '최대 단어 길이');
  if (minWordLength > maxWordLength) throw new Error('최소 단어 길이는 최대 길이보다 클 수 없습니다.');
  return { durationSeconds, fallSeconds, minWordLength, maxWordLength };
}

function validateDifficulties(input) {
  return Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, validateDifficultySettings(input?.[difficulty])]));
}

function readGameSettings(data) {
  if (!data) return structuredClone(DEFAULT_GAME_SETTINGS);
  return { ...validateGameSettings({ ...data, difficulties: readDifficulties(data.difficulties) }), version: integer(data.version ?? 0, 0, Number.MAX_SAFE_INTEGER, '설정 버전') };
}

// Upgrade stored pre-battle settings on read; active session snapshots stay intact.
function readDifficulties(input) {
  return validateDifficulties(Object.fromEntries(DIFFICULTIES.map((difficulty) => {
    const value = input?.[difficulty] || DEFAULT_DIFFICULTY_SETTINGS[difficulty];
    return [difficulty, { ...value, durationSeconds: Math.max(90, value.durationSeconds) }];
  })));
}

const filterGameLessons = (lessons, settings) => settings.sourceMode === 'selected'
  ? lessons.filter((lesson) => settings.unitIds.includes(String(lesson.unitId || '').trim()))
  : lessons;

const uniqueWordCount = (words) => new Set(words.map((word) => normalizeAnswer(word.text))).size;

function gameCatalog(lessons, settings) {
  const excluded = new Set(settings.excludedWords || []);
  const custom = (settings.customWords || []).map((text) => ({ text, unitId: '__weplay_custom__', lessonTitle: '직접 추가한 단어', context: '' }));
  return [...extractLessonWords(filterGameLessons(lessons, settings)), ...custom].filter((word) => !excluded.has(normalizeAnswer(word.text)));
}

const filterDifficultyWords = (catalog, config) => catalog.filter((word) => {
  const length = Array.from(normalizeAnswer(word.text)).length;
  return length >= config.minWordLength && length <= config.maxWordLength;
});

const decodeText = (value) => String(value || '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
    const code = n.toLowerCase().startsWith('x') ? parseInt(n.slice(1), 16) : Number(n);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  })
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, n) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[n.toLowerCase()])
  .replace(/\s+/g, ' ').trim();

const timestampMs = (value) => {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

function effectiveLessons(scoped, legacy, options = {}) {
  const latest = (items) => {
    const map = new Map();
    [...items].sort((a, b) => Math.max(timestampMs(b.updatedAt), timestampMs(b.createdAt)) - Math.max(timestampMs(a.updatedAt), timestampMs(a.createdAt)))
      .forEach((lesson) => {
        const id = String(lesson.unitId || '').trim();
        if (id && !map.has(id)) map.set(id, lesson);
      });
    return map;
  };
  const scopedMap = latest(scoped);
  const legacyMap = latest(legacy);
  return [...scopedMap.values(), ...[...legacyMap.entries()].filter(([id]) => !scopedMap.has(id)).map(([, lesson]) => lesson)]
    .filter((lesson) => (options.includeHidden === true || lesson.isVisibleToStudents !== false) && !lesson.deletedAt);
}

function extractLessonWords(lessons) {
  const words = [];
  for (const lesson of lessons) {
    const unitId = String(lesson.unitId || '').trim();
    const seen = new Set();
    const add = (raw, context = '') => {
      const text = decodeText(raw).normalize('NFKC');
      const key = normalizeAnswer(text);
      if (!key || Array.from(text).length > MAX_CATALOG_WORD_LENGTH || text.startsWith('fn:') || !/[\p{L}\p{N}]/u.test(text) || /[<>\u0000-\u001f]/.test(text) || seen.has(key)) return;
      seen.add(key);
      words.push({ text, unitId, lessonTitle: decodeText(lesson.title).slice(0, 120), context: decodeText(context).slice(0, 240) });
    };
    const visiblePages = new Set((Array.isArray(lesson.worksheetPageImages) ? lesson.worksheetPageImages : [])
      .filter((page) => String(page?.imageUrl || '').trim()).map((page) => Math.max(1, Number(page.page) || 1)));
    for (const blank of Array.isArray(lesson.worksheetBlanks) ? lesson.worksheetBlanks : []) {
      if (visiblePages.has(Math.max(1, Number(blank?.page) || 1)) && Number(blank?.widthRatio) > 0 && Number(blank?.heightRatio) > 0) add(blank.answer);
    }
    const html = decodeText(String(lesson.contentHtml || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ''));
    for (const match of html.matchAll(/\[([^\]\r\n]+)\]/g)) {
      add(match[1], html.slice(Math.max(0, match.index - 100), match.index + match[0].length + 100));
    }
    // Saved OCR/PDF text regions cover recognizable worksheet words even when
    // the teacher has not made them into blanks. Removed pages stay excluded.
    const recognized = [];
    for (const region of Array.isArray(lesson.worksheetTextRegions) ? lesson.worksheetTextRegions : []) {
      if (!visiblePages.has(Math.max(1, Number(region?.page) || 1)) || !(Number(region?.width) > 0) || !(Number(region?.height) > 0)) continue;
      const label = decodeText(region.label).normalize('NFKC').replace(/\[fn:[^\]]*\]/gi, '');
      for (const token of label.matchAll(/\[([^\]\r\n]+)\]|[\p{L}\p{N}]+(?:[·‧.‐‑-][\p{L}\p{N}]+)*/gu)) {
        const text = token[1] || token[0];
        if (/[\p{L}]/u.test(text) && !OCR_STOP_WORDS.has(normalizeAnswer(text))) recognized.push({ text, context: label });
      }
    }
    const knownTerms = new Set([...seen, ...recognized.map((word) => normalizeAnswer(word.text)), ...SPECIAL_FALLBACK_WORDS.map(normalizeAnswer)]);
    for (const word of recognized) {
      // Strip an attached particle only when the remaining term is actually
      // known; never guess at endings of proper nouns such as 국가 or 가야.
      const key = normalizeAnswer(word.text);
      const suffix = OCR_PARTICLES.find((particle) => key.endsWith(particle) && knownTerms.has(key.slice(0, -particle.length)));
      add(suffix ? word.text.slice(0, -suffix.length).trim() : word.text, word.context);
    }
  }
  return words;
}

// A class receives the same deterministic word/length order during a ranking period.
// The current visible lesson catalog is re-read on every new game so hidden material never leaks.
function buildWords(catalog, seed, difficulty = 'medium', difficultySettings = DEFAULT_DIFFICULTY_SETTINGS[difficulty], options = {}) {
  if (!DIFFICULTIES.includes(difficulty)) throw new Error('게임 난이도를 선택해 주세요.');
  const config = validateDifficultySettings(difficultySettings);
  const unique = [...new Map(filterDifficultyWords(catalog, config).map((word) => [normalizeAnswer(word.text), word])).values()];
  if (unique.length < 3) throw new Error('출제 범위에 서로 다른 빈칸 정답이 3개 이상 필요합니다.');
  const sorted = unique.sort((a, b) => hash(`${seed}:${normalizeAnswer(a.text)}`).localeCompare(hash(`${seed}:${normalizeAnswer(b.text)}`)));
  const normalCount = Math.round(config.durationSeconds * BATTLE_NORMAL_WORDS / 90);
  const normalWords = Array.from({ length: normalCount }, (_, index) => {
    const stage = Math.floor(index * 3 / normalCount) + 1;
    const localIndex = index - Math.ceil((stage - 1) * normalCount / 3);
    const fallDurationMs = config.fallSeconds[stage - 1] * 1000;
    const phaseDurationMs = config.durationSeconds * 1000 / 3;
    const count = Math.ceil(stage * normalCount / 3) - Math.ceil((stage - 1) * normalCount / 3);
    const spawnAtMs = Math.floor((stage - 1) * phaseDurationMs + localIndex * (phaseDurationMs - fallDurationMs - 1000) / (count - 1));
    return { ...sorted[index % sorted.length], id: `word-${index + 1}`, kind: 'normal', stage, spawnAtMs, fallDurationMs };
  });
  const excluded = new Set((options.excludedWords || []).map(normalizeAnswer));
  const specialOrder = (a, b) => hash(`${seed}:special:${normalizeAnswer(a.text)}`).localeCompare(hash(`${seed}:special:${normalizeAnswer(b.text)}`));
  const longWords = [...new Map(catalog.filter((word) => {
    const key = normalizeAnswer(word.text);
    return Array.from(key).length >= 6 && Array.from(key).length <= MAX_CATALOG_WORD_LENGTH && !excluded.has(key);
  }).map((word) => [normalizeAnswer(word.text), word])).values()].sort(specialOrder);
  const knownSpecials = new Set(longWords.map((word) => normalizeAnswer(word.text)));
  const fallback = SPECIAL_FALLBACK_WORDS.filter((text) => !excluded.has(normalizeAnswer(text)) && !knownSpecials.has(normalizeAnswer(text)))
    .map((text) => ({ text, unitId: '__weplay_tactic__', lessonTitle: '전술 도전', context: '' })).sort(specialOrder);
  const specials = [...longWords, ...fallback].slice(0, 2);
  return [...normalWords, ...specials.map((word, index) => {
    const phase = index + 1;
    return {
      ...word, id: `special-${phase}`, kind: 'special', tactic: phase === 1 ? 'crane-wing' : 'last-stand',
      stage: phase + 1, spawnAtMs: Math.floor(config.durationSeconds * 1000 * phase / 3), fallDurationMs: 5000,
    };
  })];
}

function assessAnswer(session, wordId, answer, nowMs) {
  if (session.status !== 'active') return { accepted: false, reason: 'finished' };
  if (session.battleVersion === 1 && simulateWeplayBattle(session, nowMs - session.startsAtMs).outcome === 'defeat') return { accepted: false, reason: 'defeated' };
  const word = session.words.find((entry) => entry.id === wordId);
  if (!word) return { accepted: false, reason: 'unknown_word' };
  if ((session.acceptedWordIds || []).includes(wordId)) return { accepted: false, reason: 'already_accepted' };
  const elapsed = nowMs - session.startsAtMs;
  if (elapsed < word.spawnAtMs + 100) return { accepted: false, reason: 'not_started' };
  const grace = session.battleVersion === 1 && word.kind === 'special' ? 0 : ANSWER_GRACE_MS;
  const deadline = word.spawnAtMs + word.fallDurationMs + grace;
  if (session.battleVersion === 1 ? elapsed >= deadline || nowMs >= session.endsAtMs : elapsed > deadline || nowMs > session.endsAtMs) return { accepted: false, reason: 'expired' };
  if (normalizeAnswer(answer) !== normalizeAnswer(word.text)) return { accepted: false, reason: 'incorrect' };
  return { accepted: true };
}

function gameReward(policy, correctCount) {
  return [...policy.resultRewards].reverse().find((row) => correctCount >= row.minCorrect)?.amount || 0;
}

function periodBounds(nowMs, frequency, notBefore = 0) {
  const kst = new Date(nowMs + 9 * 3600000);
  let start;
  let end;
  if (frequency === 'monthly') {
    start = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1) - 9 * 3600000;
    end = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + 1, 1) - 9 * 3600000;
  } else {
    const mondayOffset = (kst.getUTCDay() + 6) % 7;
    start = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - mondayOffset) - 9 * 3600000;
    end = start + 7 * 86400000;
  }
  return { startsAtMs: Math.max(start, notBefore), endsAtMs: end };
}

const compareEntries = (a, b) => Number(b.score || 0) - Number(a.score || 0)
  || Number(a.achievedAtMs || 0) - Number(b.achievedAtMs || 0)
  || String(a.uid).localeCompare(String(b.uid));

module.exports = { TOTAL_WORDS, BATTLE_NORMAL_WORDS, GAME_DURATION_MS, START_DELAY_MS, ANSWER_GRACE_MS, PERIOD_SETTLEMENT_DELAY_MS, DIFFICULTIES, FALL_DURATIONS, GAME_ID, MAX_CATALOG_WORD_LENGTH, SPECIAL_FALLBACK_WORDS, DEFAULT_GAME_SETTINGS, DEFAULT_DIFFICULTY_SETTINGS, DEFAULT_POLICY, hash, normalizeAnswer, validatePolicy, readPolicy, validateUnitIds, validateGameSettings, readGameSettings, readDifficulties, validateDifficulties, validateDifficultySettings, gameCatalog, filterDifficultyWords, filterGameLessons, uniqueWordCount, effectiveLessons, extractLessonWords, buildWords, assessAnswer, gameReward, periodBounds, compareEntries };
