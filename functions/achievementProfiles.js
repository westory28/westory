const { HttpsError } = require('firebase-functions/v2/https');

// Keep the retired command recognizable to stale clients, but reject it before
// any diagnostic/formative evidence or analysis profile is read or written.
const COMMAND_TYPE = 'saveAchievementProfile';
const retired = () => {
  throw new HttpsError('failed-precondition', '모의고사 점수 분석으로 변경되었습니다. 화면을 새로고침해 주세요.',
    { reason: 'ACHIEVEMENT_PROFILE_RETIRED' });
};

module.exports = { COMMAND_TYPE, normalizeProfilePayload: retired, applyProfile: retired };
