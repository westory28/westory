const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { catalog, sanitizePublicAvatar } = require('./studentAvatarCatalog');

const hash = value => createHash('sha256').update(value).digest('hex');
const participationPath = uid => `avatar_event_participations/${hash(uid)}`;
const semesterRoot = scope => `years/${scope.slice(0, 4)}/semesters/${scope.slice(-1)}`;
const questionPath = (scope, id) => `${semesterRoot(scope)}/gongsinmoongo_questions/${id}`;
const fail = (code, message, reason) => { throw new HttpsError(code, message, { reason }); };
const defaultAvatarEvent = () => ({ enabled: false, rewardWis: 100 });
const normalizeAvatarEvent = (raw, previous = defaultAvatarEvent()) => {
  const value = raw === undefined ? previous : raw;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['enabled', 'rewardWis'].includes(key))
    || typeof value.enabled !== 'boolean' || !Number.isSafeInteger(value.rewardWis) || value.rewardWis < 1 || value.rewardWis > 1000000)
    fail('invalid-argument', '아바타 행사 운영 여부와 보상 위스를 확인해 주세요.', 'GONGSIN_AVATAR_SETTINGS_INVALID');
  return { enabled: value.enabled, rewardWis: value.rewardWis };
};
const projectAvatarSubmission = (questionId, question) => {
  if (!question?.avatarEvent) return undefined;
  const event = question.avatarEvent;
  return { questionId, semesterId: question.semesterId, description: event.description,
    thumbnailUrl: event.thumbnailUrl, look: event.look, avatarRevision: event.avatarRevision,
    rewardWis: event.rewardWis, submittedAt: event.submittedAt,
    ...(event.rewardedAt ? { rewardedAt: event.rewardedAt, ledgerEntryId: event.ledgerEntryId } : {}) };
};
const readAvatarParticipation = async (db, tx, uid) => {
  const ref = db.doc(participationPath(uid)), marker = (await tx.get(ref)).data();
  if (!marker) return { ref, marker: null, question: null };
  if (marker.deleted === true) return { ref, marker, question: null };
  if (!/^\d{4}-[12]$/.test(marker.semesterId || '')
    || !/^avatar_[a-f0-9]{64}$/.test(marker.questionId || ''))
    fail('failed-precondition', '아바타 행사 참여 기록을 확인해 주세요.', 'GONGSIN_AVATAR_PARTICIPATION_INVALID');
  const question = (await tx.get(db.doc(questionPath(marker.semesterId, marker.questionId)))).data();
  if (question && (question.studentId !== uid || question.source?.kind !== 'avatar'))
    fail('failed-precondition', '아바타 행사 접수 내용을 확인해 주세요.', 'GONGSIN_AVATAR_PARTICIPATION_INVALID');
  return { ref, marker, question: question || null };
};
const avatarEventState = (settings, participation) => {
  const event = normalizeAvatarEvent(settings.avatarEvent);
  const submission = participation.question && projectAvatarSubmission(participation.marker.questionId, participation.question);
  return { enabled: settings.enabled === true && event.enabled, rewardWis: event.rewardWis,
    participated: Boolean(participation.marker), ...(submission ? { submission } : {}) };
};
const readSavedAvatarSnapshot = async (db, tx, uid, expectedRevision) => {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    fail('invalid-argument', '아바타를 저장한 뒤 보내 주세요.', 'GONGSIN_AVATAR_REQUIRED');
  const [savedDoc, deletion] = await tx.getAll(db.doc(`student_avatars/${uid}`), db.doc(`student_avatar_deletions/${uid}`));
  const saved = savedDoc.data(), avatar = sanitizePublicAvatar(saved);
  const prefix = `student_avatar_thumbnails/v2/${hash(uid)}/`;
  if (deletion.exists || !saved || saved.studentUid !== uid || saved.catalogVersion !== catalog.version
    || saved.requiresThumbnailRefresh === true || !avatar?.thumbnailUrl || !saved.lastSavedAtMs
    || typeof saved.thumbnailPath !== 'string' || !saved.thumbnailPath.startsWith(prefix)
    || !avatar.thumbnailUrl.includes(`/o/${encodeURIComponent(saved.thumbnailPath)}?alt=media&token=`))
    fail('failed-precondition', '현재 아바타를 저장한 뒤 보내 주세요.', 'GONGSIN_AVATAR_REQUIRED');
  if (saved.revision !== expectedRevision)
    fail('aborted', '아바타가 변경되었습니다. 현재 모습을 확인한 뒤 다시 보내 주세요.', 'GONGSIN_AVATAR_CHANGED');
  return { thumbnailUrl: avatar.thumbnailUrl, thumbnailPath: saved.thumbnailPath, look: avatar.look, avatarRevision: avatar.revision };
};

module.exports = { defaultAvatarEvent, normalizeAvatarEvent, participationPath, projectAvatarSubmission,
  readAvatarParticipation, avatarEventState, readSavedAvatarSnapshot };
