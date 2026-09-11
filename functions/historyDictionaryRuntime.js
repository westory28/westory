const { HttpsError } = require("firebase-functions/v2/https");
const fail = (reason, message) => { throw new HttpsError("failed-precondition", message, { reason }); };
const createHistoryDictionaryRuntime = ({ db, semesterCore, archiveEnrollment, legacyRewards, wisRewards, dictionaryNotifications, getWisHallOfFamePath }) => ({
  prepare: async context => {
    const { transaction: wrapper, actor, payload, uid, termId, commandType, student, timestamp, concreteTimestamp, commandId, receiptId } = context;
    const transaction = wrapper.native;
    const user = await transaction.get(db.doc(`users/${actor.actorUid}`));
    const profile = user.exists ? user.data() : {};
    if (actor.actorRole !== "admin" && (!user.exists || profile.role !== actor.actorRole || (profile.uid && profile.uid !== actor.actorUid)))
      fail("HISTORY_DICTIONARY_ROLE_CHANGED", "계정 권한이 변경되었습니다. 다시 로그인해 주세요.");
    const scope = { year: payload.year, semester: payload.semester, semesterId: `${payload.year}-${payload.semester}` };
    if (student) {
      const [pointer, manifest, slot] = await transaction.getAll(
        db.doc(semesterCore.ACTIVE_SEMESTER_POINTER_PATH),
        db.doc(`${semesterCore.SEMESTER_MANIFEST_COLLECTION}/${scope.semesterId}`),
        db.doc(`${archiveEnrollment.ENROLLMENT_SLOT_COLLECTION}/${archiveEnrollment.buildEnrollmentSlotId(scope.semesterId, uid)}`),
      );
      const p = pointer.data(), m = manifest.data(), s = slot.data();
      if (!pointer.exists || !manifest.exists || p.semesterId !== scope.semesterId || p.revision !== m.revision || m.status !== "ACTIVE" || m.readOnly === true)
        fail("HISTORY_DICTIONARY_SEMESTER_CHANGED", "현재 학기가 변경되었습니다. 사전을 다시 열어 주세요.");
      if (!slot.exists || typeof s.activeEnrollmentId !== "string" || !/^[^/\\\x00-\x1f]{1,180}$/.test(s.activeEnrollmentId))
        fail("HISTORY_DICTIONARY_ENROLLMENT_REQUIRED", "현재 학기의 학생 등록 정보를 확인해 주세요.");
      const enrollment = await transaction.get(db.doc(`${archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION}/${s.activeEnrollmentId}`));
      const e = enrollment.data();
      if (!enrollment.exists || e.enrollmentId !== s.activeEnrollmentId || e.semesterId !== scope.semesterId || e.studentUid !== uid || e.enrollmentStatus !== "ACTIVE")
        fail("HISTORY_DICTIONARY_ENROLLMENT_REQUIRED", "현재 학기의 학생 등록 정보를 확인해 주세요.");
    }
    let managerRecipients = [];
    if (commandType === "requestHistoryDictionaryTerm") {
      const groups = await Promise.all([
        transaction.get(db.collection("users").where("email", "==", "westoria28@gmail.com").limit(101)),
        transaction.get(db.collection("users").where("role", "==", "teacher").limit(101)),
        transaction.get(db.collection("users").where("staffPermissions", "array-contains", "lesson_read").limit(101)),
      ]);
      managerRecipients = [...new Set(groups.flatMap(group => group.docs.map(doc => doc.id)))];
      if (groups.some(group => group.size > 100) || managerRecipients.length > 100)
        fail("HISTORY_DICTIONARY_RECIPIENT_LIMIT", "요청을 전달할 교사 목록을 확인해야 합니다. 관리자에게 문의해 주세요.");
    }
    const operation = commandType === "saveStudentHistoryDictionaryEntry" ? "award"
      : ["deleteStudentHistoryDictionaryWord", "deleteStudentHistoryDictionaryWordByTeacher"].includes(commandType) ? "reclaim" : null;
    let legacyPlan, wisPlan, wordData = {};
    if (operation) {
      const word = await transaction.get(db.doc(`users/${uid}/history_dictionary_words/${termId}`));
      wordData = word.exists ? word.data() : {};
      const targetUser = uid === actor.actorUid ? user : await transaction.get(db.doc(`users/${uid}`));
      const legacyReads = await legacyRewards.read(transaction, {
        uid, wordData, profile: targetUser.data() || {}, operation: operation === "award" ? "preserve" : "reclaim",
        actorUid: actor.actorUid, word: wordData.word || payload.word || termId,
        reason: payload.reason || `${student ? "student" : "teacher"}_deleted_history_dictionary_word`,
      });
      legacyPlan = legacyRewards.plan(legacyReads, { timestamp });
      const wisReads = await wisRewards.read(transaction, {
        operation, uid, termId, definition: payload.definition || "", word: payload.word || wordData.word || termId,
        commandId, receiptId, actorUid: actor.actorUid,
        ...(operation === "award" ? { activeScope: scope } : {}),
        legacyOrigins: legacyPlan.rewardOrigins, migratedLegacyReclaims: legacyPlan.migratedLegacyReclaims || [], wordData,
      });
      wisPlan = wisRewards.plan(wisReads, { timestamp, concreteTimestamp });
      const writes = legacyPlan.mutations.length + wisPlan.mutations.length
        + (legacyPlan.result.reclaimed ? legacyPlan.result.scopes.length : 0) + 10;
      if (writes > 500) fail("HISTORY_DICTIONARY_REWARD_BATCH_LIMIT", "연결된 지급 기록이 많아 관리자 확인이 필요합니다. 기존 단어와 보상은 유지됩니다.");
    }
    let applied = false;
    const applyRewards = () => {
      if (!legacyPlan || !wisPlan || applied) throw new Error("Dictionary reward plan applied outside its operation");
      applied = true;
      legacyRewards.apply(transaction, legacyPlan);
      wisRewards.apply(transaction, wisPlan);
      if (legacyPlan.result.reclaimed) {
        for (const origin of legacyPlan.result.scopes) transaction.set(db.doc(getWisHallOfFamePath(origin.year, origin.semester)), { sourceUpdatedAt: timestamp, sourceUpdatedAtMs: concreteTimestamp.toMillis() }, { merge: true });
      }
      return { ...wisPlan.result, reclaimed: Boolean(legacyPlan.result.reclaimed || wisPlan.result.reclaimed),
        amount: Number(legacyPlan.result.amount || 0) + Number(wisPlan.result.amount || 0) };
    };
    return {
      profile,
      rewardFields: legacyPlan ? { rewardOrigins: legacyPlan.rewardOrigins, wisRewardOrigins: wisPlan.wisRewardOrigins } : {},
      award: applyRewards, reclaim: applyRewards,
      managerRecipients,
      queueNotification: (recipient, notification, kind) => {
        const event = dictionaryNotifications.buildCommandEvent({ commandId, kind, uid: recipient, year: payload.year, semester: payload.semester, notification, timestamp });
        transaction.create(db.doc(event.path), event.data);
      },
      // Canonical projections are in the reward plan; legacy dirty markers use
      // verified original scopes above, never the caller's current semester.
      markWisDirty: async () => {},
    };
  },
});
module.exports = { createHistoryDictionaryRuntime };
