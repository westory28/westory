const { HttpsError } = require('firebase-functions/v2/https');
const catalog = require('./shared/historyAchievementStandards.json');

const ACHIEVEMENT_FIELDS = Object.freeze(['curriculumVersion', 'achievementStandardCodes',
  'achievementMappingSource', 'targetAchievementLevel', 'intendedDifficulty']);
const codes = new Set(catalog.standards.map(item => item.code));
const invalid = () => { throw new HttpsError('invalid-argument', '성취기준과 성취수준·난이도를 확인해 주세요.',
  { reason: 'ASSESSMENT_ACHIEVEMENT_METADATA_INVALID' }); };

// Old clients may omit every field. Their edits must preserve stored metadata.
function normalizeAchievementMetadata(value, { strict = false } = {}) {
  if (!ACHIEVEMENT_FIELDS.some(key => Object.hasOwn(value || {}, key))) return {};
  const rawCodes = value.achievementStandardCodes;
  const validCodes = Array.isArray(rawCodes) && rawCodes.length <= 5
    && rawCodes.every(code => typeof code === 'string' && codes.has(code))
    && new Set(rawCodes).size === rawCodes.length;
  const validVersion = value.curriculumVersion === catalog.curriculumVersion;
  const validSource = ['manual', 'unit'].includes(value.achievementMappingSource);
  const level = value.targetAchievementLevel ?? '';
  const difficulty = value.intendedDifficulty ?? '';
  const valid = validCodes && validVersion && validSource
    && ['', 'A', 'B', 'C', 'D', 'E'].includes(level)
    && ['', 'easy', 'medium', 'hard'].includes(difficulty);
  if (!valid) {
    if (strict) invalid();
    return {};
  }
  return { curriculumVersion: catalog.curriculumVersion, achievementStandardCodes: [...rawCodes],
    achievementMappingSource: value.achievementMappingSource,
    targetAchievementLevel: level, intendedDifficulty: difficulty };
}

module.exports = { ACHIEVEMENT_FIELDS, normalizeAchievementMetadata };
