const { HttpsError } = require('firebase-functions/v2/https');
const { RHYTHM_SONGS } = require('./rhythmRankingCore/rhythmSongs');

const FREE_DAILY = 3;
const PAID_COST = 50;
const DEFAULT_MISS_LIMIT = 30;
const ALLOWED_DIFFICULTIES = ['normal', 'hard'];
const dayAt = atMs => new Date(atMs + 9 * 3600000).toISOString().slice(0, 10);
const fail = message => { throw new HttpsError('invalid-argument', message); };
function readSettings(value) {
  if (!value) return { revision: 0, missLimit: DEFAULT_MISS_LIMIT, override: null };
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !Number.isSafeInteger(value.missLimit) || value.missLimit < 1 || value.missLimit > 300
    || (value.override !== null && (!value.override || typeof value.override.weekId !== 'string'
      || !RHYTHM_SONGS.some(song => song.id === value.override.songId)))) {
    throw new HttpsError('failed-precondition', '도전 설정을 확인하지 못했습니다.');
  }
  return { revision: value.revision, missLimit: value.missLimit, override: value.override };
}
function challengeFor(settings, week) {
  // UTC Monday 1970-01-05, shifted into Korea time; no scheduler or write on rollover.
  const index = Math.floor((week.startsAtMs - (4 * 86400000 - 9 * 3600000)) / (7 * 86400000));
  const automatic = RHYTHM_SONGS[((index % RHYTHM_SONGS.length) + RHYTHM_SONGS.length) % RHYTHM_SONGS.length];
  const override = settings.override?.weekId === week.id ? settings.override : null;
  return { weekId: week.id, week, songId: override?.songId || automatic.id,
    automaticSongId: automatic.id, selection: override ? 'manual' : 'automatic',
    allowedDifficulties: ALLOWED_DIFFICULTIES, missLimit: settings.missLimit,
    revision: settings.revision, dailyFreeLimit: FREE_DAILY, paidCost: PAID_COST };
}
function dailyUsage(player, atMs) {
  const dayId = dayAt(atMs);
  const used = player?.challengeDayId === dayId && Number.isSafeInteger(player?.challengeDailyUsed)
    ? Math.max(0, player.challengeDailyUsed) : 0;
  return { dayId, dailyUsed: used, freeRemaining: Math.max(0, FREE_DAILY - used) };
}
function desiredSettings(data, week) {
  if (data?.weekId !== week.id) fail('주차가 바뀌었습니다. 다시 불러온 뒤 저장해 주세요.');
  if (!['automatic', 'manual'].includes(data.selection)) fail('곡 선택 방식을 확인해 주세요.');
  if (!Number.isSafeInteger(data.missLimit) || data.missLimit < 1 || data.missLimit > 300)
    fail('아이쿠 종료 횟수는 1~300회로 입력해 주세요.');
  if (data.selection === 'manual' && !RHYTHM_SONGS.some(song => song.id === data.songId)) fail('도전 곡을 선택해 주세요.');
  return { missLimit: data.missLimit, override: data.selection === 'manual' ? { weekId: week.id, songId: data.songId } : null };
}
module.exports = { FREE_DAILY, PAID_COST, ALLOWED_DIFFICULTIES, dayAt, readSettings, challengeFor, dailyUsage, desiredSettings };
