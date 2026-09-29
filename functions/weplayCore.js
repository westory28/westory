const crypto = require('node:crypto');

const TOTAL_WORDS = 20;
const GAME_DURATION_MS = 60000;
const START_DELAY_MS = 3000;
const ANSWER_GRACE_MS = 750;
const PERIOD_SETTLEMENT_DELAY_MS = 180000;
const DIFFICULTIES = ['mild', 'medium', 'spicy'];
const FALL_DURATIONS = { mild: [12000, 10000, 8000], medium: [10000, 8000, 6000], spicy: [8000, 6000, 4000] };
const GAME_ID = 'history-rain';
const DEFAULT_GAME_SETTINGS = { enabled: true, sourceMode: 'all', unitIds: [], version: 0 };
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
  return { enabled: input.enabled, sourceMode: input.sourceMode, unitIds: input.sourceMode === 'all' ? [] : unitIds };
}

function readGameSettings(data) {
  if (!data) return structuredClone(DEFAULT_GAME_SETTINGS);
  return { ...validateGameSettings(data), version: integer(data.version ?? 0, 0, Number.MAX_SAFE_INTEGER, '설정 버전') };
}

const filterGameLessons = (lessons, settings) => settings.sourceMode === 'selected'
  ? lessons.filter((lesson) => settings.unitIds.includes(String(lesson.unitId || '').trim()))
  : lessons;

const uniqueWordCount = (words) => new Set(words.map((word) => normalizeAnswer(word.text))).size;

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
      if (!key || text.length > 12 || text.startsWith('fn:') || !/[\p{L}\p{N}]/u.test(text) || seen.has(key)) return;
      seen.add(key);
      words.push({ text, unitId, lessonTitle: decodeText(lesson.title).slice(0, 120), context: decodeText(context).slice(0, 240) });
    };
    const visiblePages = new Set((Array.isArray(lesson.worksheetPageImages) ? lesson.worksheetPageImages : [])
      .filter((page) => String(page?.imageUrl || '').trim()).map((page) => Math.max(1, Number(page.page) || 1)));
    for (const blank of Array.isArray(lesson.worksheetBlanks) ? lesson.worksheetBlanks : []) {
      if (visiblePages.has(Math.max(1, Number(blank?.page) || 1)) && Number(blank?.widthRatio) > 0 && Number(blank?.heightRatio) > 0) add(blank.answer);
    }
    const html = String(lesson.contentHtml || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    for (const match of html.matchAll(/\[([^\]\r\n]+)\]/g)) {
      add(match[1], html.slice(Math.max(0, match.index - 100), match.index + match[0].length + 100));
    }
  }
  return words;
}

// A class receives the same deterministic word/length order during a ranking period.
// The current visible lesson catalog is re-read on every new game so hidden material never leaks.
function buildWords(catalog, seed, difficulty = 'medium') {
  if (!DIFFICULTIES.includes(difficulty)) throw new Error('게임 난이도를 선택해 주세요.');
  const unique = [...new Map(catalog.map((word) => [normalizeAnswer(word.text), word])).values()];
  if (unique.length < 3) throw new Error('출제 범위에 서로 다른 빈칸 정답이 3개 이상 필요합니다.');
  const sorted = unique.sort((a, b) => hash(`${seed}:${normalizeAnswer(a.text)}`).localeCompare(hash(`${seed}:${normalizeAnswer(b.text)}`)));
  return Array.from({ length: TOTAL_WORDS }, (_, index) => {
    const stage = index < 7 ? 1 : index < 14 ? 2 : 3;
    const localIndex = index < 7 ? index : index < 14 ? index - 7 : index - 14;
    const fallDurationMs = FALL_DURATIONS[difficulty][stage - 1];
    const count = stage < 3 ? 7 : 6;
    const spawnAtMs = (stage - 1) * 20000 + Math.floor(localIndex * (20000 - fallDurationMs - 1000) / (count - 1));
    return { ...sorted[index % sorted.length], id: `word-${index + 1}`, stage, spawnAtMs, fallDurationMs };
  });
}

function assessAnswer(session, wordId, answer, nowMs) {
  if (session.status !== 'active') return { accepted: false, reason: 'finished' };
  const word = session.words.find((entry) => entry.id === wordId);
  if (!word) return { accepted: false, reason: 'unknown_word' };
  if ((session.acceptedWordIds || []).includes(wordId)) return { accepted: false, reason: 'already_accepted' };
  const elapsed = nowMs - session.startsAtMs;
  if (elapsed < word.spawnAtMs + 100) return { accepted: false, reason: 'not_started' };
  if (elapsed > word.spawnAtMs + word.fallDurationMs + ANSWER_GRACE_MS || nowMs > session.endsAtMs) return { accepted: false, reason: 'expired' };
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

module.exports = { TOTAL_WORDS, GAME_DURATION_MS, START_DELAY_MS, ANSWER_GRACE_MS, PERIOD_SETTLEMENT_DELAY_MS, DIFFICULTIES, FALL_DURATIONS, GAME_ID, DEFAULT_GAME_SETTINGS, DEFAULT_POLICY, hash, normalizeAnswer, validatePolicy, readPolicy, validateUnitIds, validateGameSettings, readGameSettings, filterGameLessons, uniqueWordCount, effectiveLessons, extractLessonWords, buildWords, assessAnswer, gameReward, periodBounds, compareEntries };
