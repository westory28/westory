const { createHash } = require('node:crypto');
const { Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');
const { createStudentWisWallet } = require('./studentWisWallet');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const safeId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(value);
const reject = () => { throw new HttpsError('failed-precondition', '저장된 학습 기록과 현재 학기를 확인해 주세요.'); };
const millis = (value) => typeof value?.toMillis === 'function' ? value.toMillis() : 0;

// This endpoint accepts only server-validated learning evidence. Retired quiz,
// assessment, map, attendance and core-point reward endpoints stay retired.
const createStudentLearningRewardHandler = ({ db, loadPolicy, assertSession = assertScoreWorkflowSession }) => {
  const wallet = createStudentWisWallet({ db, actorUid: 'system:learning' });
  return async (request) => {
    await assertSession(request);
    const data = request.data || {}, { year, semester, activityType, sourceId } = data;
    if (Object.keys(data).some((key) => !['year','semester','activityType','sourceId','_session'].includes(key))
      || !/^\d{4}$/.test(String(year)) || !/^[12]$/.test(String(semester))
      || !['lesson','think_cloud'].includes(activityType) || typeof sourceId !== 'string' || sourceId.length > 400) {
      throw new HttpsError('invalid-argument', '학습 보상 요청을 확인해 주세요.');
    }
    const scope = { year: String(year), semester: String(semester) }, semesterId = `${year}-${semester}`;
    const uid = request.auth.uid, root = `years/${year}/semesters/${semester}`;
    const receiptRef = db.doc(`${root}/student_learning_rewards/${hash(uid+'\n'+activityType+'\n'+sourceId)}`);
    const stateRef = db.doc(`${root}/student_learning_reward_states/${hash(uid+'\n'+activityType)}`);
    return db.runTransaction(async (transaction) => {
      const loaded = await wallet.read(transaction, scope, uid);
      const [receipt, state, policy, legacy] = await Promise.all([
        transaction.get(receiptRef), transaction.get(stateRef), loadPolicy(transaction, scope.year, scope.semester),
        transaction.get(db.collection(`${root}/point_transactions`).where('uid','==',uid)),
      ]);
      const empty = (duplicate, blockedMessage) => ({ awarded:false, duplicate, amount:0, totalAwarded:0, balance:loaded.wallet.balance, blockedMessage });
      if (receipt.exists) return empty(true, '이번 학습 위스는 이미 반영되었습니다.');
      let reason;
      if (activityType === 'lesson') {
        const unitId = sourceId.startsWith('lesson-') ? sourceId.slice(7) : '';
        if (!safeId(unitId)) reject();
        const [progress, lessons] = await Promise.all([
          transaction.get(db.doc(`${root}/lesson_progress/${uid}/units/${unitId}`)),
          transaction.get(db.collection(`${root}/lessons`).where('unitId','==',unitId).limit(2)),
        ]);
        const saved = progress.data() || {}, lesson = lessons.docs[0]?.data();
        if (lessons.size !== 1 || !lesson || lesson.deletedAt || lesson.isVisibleToStudents === false
          || (Array.isArray(lesson.assignedClassIds) && lesson.assignedClassIds.length && !lesson.assignedClassIds.includes(loaded.wallet.classId))
          || saved.studentUid !== uid || saved.semesterId !== semesterId || saved.completed !== true
          || !Number.isSafeInteger(saved.answerRevision) || saved.answerRevision < 1 || saved.contentRevision !== (lesson.contentRevision || 0)) reject();
        reason = '수업 자료 학습';
      } else {
        const parts = sourceId.split(':');
        if (parts.length !== 3 || parts[0] !== 'think-cloud' || !safeId(parts[1]) || !safeId(parts[2])) reject();
        const [session, response] = await Promise.all([
          transaction.get(db.doc(`${root}/think_cloud_sessions/${parts[1]}`)),
          transaction.get(db.doc(`${root}/think_cloud_sessions/${parts[1]}/responses/${parts[2]}`)),
        ]);
        const saved = response.data() || {}, topic = session.data() || {};
        if (!session.exists || topic.deletedAt || topic.classId !== loaded.wallet.classId
          || saved.uid !== uid || saved.revision !== 1 || !parts[2].startsWith('thinkresp_') || !saved.textNormalized || !saved.createdAt) reject();
        reason = '생각모아 참여';
      }
      const prior = legacy.docs.map(doc => doc.data()).filter(row => (row.activityType || row.type) === activityType && Number(row.delta) > 0);
      if (prior.some(row => row.sourceId === sourceId)) return empty(true, '이번 학습 위스는 이미 반영되었습니다.');
      const rule = activityType === 'lesson' ? policy.rewardPolicy.lesson : policy.rewardPolicy.thinkCloud;
      const amount = Number(rule.amount || 0);
      if (!policy.autoRewardEnabled || !rule.enabled || amount === 0) return empty(false, '현재 이 활동의 위스 적립이 꺼져 있습니다.');
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000000) reject();
      if (activityType === 'think_cloud') {
        const claimCount = Number(state.data()?.claimCount || 0) + prior.length;
        const maxClaims = Number(rule.maxClaims || 0);
        if (maxClaims > 0 && claimCount >= maxClaims) return empty(true, `누적 최대 ${maxClaims}회까지 적립됩니다.`);
        const latest = Math.max(millis(state.data()?.lastAwardedAt), ...prior.map(row => millis(row.createdAt)), 0);
        if (latest && Date.now() - latest < Number(rule.cooldownHours || 24) * 3600000) return empty(true, '위스 적립 간격이 지나면 다시 적립됩니다.');
      }
      const balance = wallet.write(transaction, scope, uid, amount, activityType, sourceId, reason, loaded, receiptRef.path);
      const now = Timestamp.now();
      const result = { awarded:true, duplicate:false, amount, totalAwarded:amount, balance, sourceId };
      transaction.create(receiptRef, { ...result, studentUid:uid, semesterId, activityType, createdAt:now });
      transaction.set(stateRef, { studentUid:uid, semesterId, activityType, claimCount:Number(state.data()?.claimCount || 0)+1, lastAwardedAt:now });
      return result;
    });
  };
};
module.exports = { createStudentLearningRewardHandler };
