const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const eventSource = process.env.AVATAR_EVENT_SOURCE_ROOT ? require('node:path').resolve(process.env.AVATAR_EVENT_SOURCE_ROOT) : require('node:path').resolve(__dirname, '..');
const fromSource = file => require(require('node:path').join(eventSource, file));
const { createGongsinmoongoHandlers, defaultSettings } = fromSource('gongsinmoongo');
const { participationPath, normalizeAvatarEvent } = fromSource('avatarEvent');
const { catalog, defaultLook, lookHash } = fromSource('studentAvatarCatalog');
const { accountIdFor } = fromSource('studentWisWallet');
const { buildEnrollmentSlotId } = require('../productionGateway/archiveEnrollment');
const hash = value => createHash('sha256').update(value).digest('hex');

// Runs against the existing dedicated real Firestore emulator/session fixture.
module.exports = async function verifyAvatarEvent(h) {
  const { db, api, request, command, query, check, counts, get, resetMetrics, metrics, now, scope, root, reason, instrumented } = h;
  const accountId = accountIdFor(scope, 'a'), accountPath = `semester_wis_accounts/${accountId}`;
  const settingsPath = `${root}/gongsinmoongo_config/settings`;
  const submission = { description: '별빛 옷을 입은 저의 아바타입니다.', expectedAvatarRevision: 3 };
  const seedEvent = async () => {
    const look = defaultLook('boy'), thumbnailPath = `student_avatar_thumbnails/v2/${hash('a')}/${'b'.repeat(64)}.webp`;
    const thumbnailUrl = `https://firebasestorage.googleapis.com/v0/b/synthetic.appspot.com/o/${encodeURIComponent(thumbnailPath)}?alt=media&token=00000000-0000-0000-0000-000000000000`;
    const rows = {
      [settingsPath]: { ...defaultSettings(), enabled: true, revision: 1, teacherQuestionNotifications: false,
        studentReplyNotifications: false, avatarEvent: { enabled: true, rewardWis: 100 } },
      'student_avatars/a': { schemaVersion: 1, catalogVersion: catalog.version, studentUid: 'a', revision: 3,
        look, lookHash: lookHash(look), thumbnailPath, thumbnailUrl, lastSavedAtMs: now(), ownedItemIds: [] },
      'student_identities/a': { studentUid: 'a', accountStatus: 'ACTIVE' },
      'semester_enrollments/en_a': { enrollmentId: 'en_a', semesterId: scope, studentUid: 'a', classId: 'class_one', enrollmentStatus: 'ACTIVE' },
      'semester_classes/class_one': { classId: 'class_one', semesterId: scope, status: 'ACTIVE' },
      [`semester_wis_economies/${scope}`]: { semesterId: scope, status: 'ACTIVE_OPEN', revision: 1, ledgerEntryCount: 0 },
      [accountPath]: { accountId, studentUid: 'a', semesterId: scope, schemaVersion: 1, policyVersion: 'w7-v1', status: 'ACTIVE',
        enrollmentId: 'en_a', classId: 'class_one', revision: 1, balance: 500, earnedTotal: 500, rankEarnedTotal: 500,
        spentTotal: 0, adjustedTotal: 500, recentLedgerEntries: [] },
    };
    await Promise.all(Object.entries(rows).map(([path, value]) => db.doc(path).set(value)));
    resetMetrics(); return rows['student_avatars/a'];
  };
  const ledgerCount = async () => (await db.collection('semester_wis_ledger').get()).size;
  await check('avatar event: disabled default, validated settings, old settings clients preserve event and no-op has zero writes', async () => {
    assert.deepEqual((await query('a', 'avatar-event')), { enabled: false, rewardWis: 100, participated: false });
    assert.deepEqual(normalizeAvatarEvent(undefined), { enabled: false, rewardWis: 100 });
    for (const rewardWis of [0, -1, 1.1, 1000001, '100']) assert.throws(() => normalizeAvatarEvent({ enabled: true, rewardWis }), reason('GONGSIN_AVATAR_SETTINGS_INVALID'));
    await seedEvent();
    const settings = { ...(await query('admin', 'state')).settings }; delete settings.avatarEvent;
    resetMetrics(); const result = await command('admin', 'settings', { settings, expectedRevision: 1 });
    assert.deepEqual(result.settings.avatarEvent, { enabled: true, rewardWis: 100 });
    assert.equal(metrics().writes, 0); counts.avatarSettingsNoop = { ...metrics() };
    const changed = await command('admin', 'settings', { settings: { ...result.settings, avatarEvent: { enabled: true, rewardWis: 250 } }, expectedRevision: 1 });
    assert.equal(changed.settings.avatarEvent.rewardWis, 250);
    assert.deepEqual(await get(`${root}/gongsinmoongo_config/public`), { enabled: true, revision: 2, contentRevision: 0, avatarEventEnabled: true, avatarEventRewardWis: 250 });
  });
  await check('avatar event: server-owned saved snapshot, single submission, no automatic wallet payment, retry zero writes', async () => {
    const saved = await seedEvent();
    const req = request('a', { action: 'submitAvatar', requestId: randomUUID(), ...submission });
    const value = await api.manageGongsinmoongo(req); counts.avatarSubmit = { ...metrics() };
    assert.equal(metrics().writes, 3); assert.equal(metrics().queries, 0);
    assert.equal(value.question.source.kind, 'avatar'); assert.equal(value.question.reply, '');
    assert.equal(value.avatarEvent.submission.thumbnailUrl, saved.thumbnailUrl);
    assert.deepEqual(value.avatarEvent.submission.look, saved.look); assert.equal(value.avatarEvent.submission.avatarRevision, 3);
    assert.equal(value.avatarEvent.submission.rewardWis, 100); assert.equal(value.avatarEvent.submission.rewardedAt, undefined);
    const marker = await get(participationPath('a'));
    assert.equal(marker.thumbnailPath, saved.thumbnailPath); assert.equal(marker.studentId, undefined); assert.equal(marker.description, undefined);
    assert.equal((await get(accountPath)).balance, 500); assert.equal(await ledgerCount(), 0);
    for (const duplicate of [req, request('a', { action: 'submitAvatar', requestId: randomUUID(), ...submission, description: '새 요청도 한 번만' })]) {
      resetMetrics(); const replay = await api.manageGongsinmoongo(duplicate);
      assert.equal(replay.replayed, true); assert.equal(replay.question.id, value.question.id); assert.equal(metrics().writes, 0);
      counts.avatarSubmitRetry = { ...metrics() };
    }
    assert.equal((await db.collection(`${root}/gongsinmoongo_receipts`).get()).size, 1);
    await assert.rejects(query('b', 'detail', { questionId: value.question.id }), reason('GONGSIN_QUESTION_NOT_FOUND'));
    assert.equal((await query('b', 'avatar-event')).participated, false);
    assert.equal((await query('teacher', 'detail', { questionId: value.question.id })).question.avatarEvent.description, submission.description);
  });
  await check('avatar event: twenty concurrent different request IDs create exactly one lifetime submission', async () => {
    await seedEvent();
    const values = await Promise.all(Array.from({ length: 20 }, () => command('a', 'submitAvatar', submission)));
    assert.equal(values.filter(value => !value.replayed).length, 1);
    assert.equal(new Set(values.map(value => value.question.id)).size, 1);
    assert.equal((await db.collection(`${root}/gongsinmoongo_questions`).get()).size, 1);
    assert.equal((await db.collection('avatar_event_participations').get()).size, 1);
    assert.equal((await db.collection(`${root}/gongsinmoongo_receipts`).get()).size, 1);
    assert.equal((await get(accountPath)).balance, 500); assert.equal(await ledgerCount(), 0);
    counts.avatarConcurrentSubmit = { ...metrics(), calls: 20, committedQuestions: 1, committedReceipts: 1, ledgerEntries: 0 };
  });
  await check('avatar event: teacher approval uses submitted amount, canonical wallet and projections, concurrent approvals pay once', async () => {
    await seedEvent(); const { question } = await command('a', 'submitAvatar', submission);
    await db.doc(settingsPath).update({ avatarEvent: { enabled: false, rewardWis: 900 }, enabled: false });
    resetMetrics();
    const req = request('teacher', { action: 'rewardAvatar', requestId: randomUUID(), questionId: question.id, expectedRevision: 1 });
    const paid = await api.manageGongsinmoongo(req); counts.avatarReward = { ...metrics() };
    assert.equal(metrics().writes, 8); assert.equal(metrics().queries, 0);
    assert.equal(paid.reward.awarded, true); assert.equal(paid.reward.amount, 100); assert.equal(paid.reward.balance, 600);
    assert.equal(paid.question.avatarEvent.rewardWis, 100); assert(paid.question.avatarEvent.rewardedAt);
    assert.equal((await get(accountPath)).balance, 600);
    assert.equal((await get(`semester_wis_balances/${accountId}`)).balance, 600);
    assert.equal((await get(`semester_wis_rankings/${accountId}`)).rankEarnedTotal, 600);
    assert.equal((await get(`semester_wis_economies/${scope}`)).ledgerEntryCount, 1);
    const ledger = await get(`semester_wis_ledger/${paid.reward.ledgerEntryId}`);
    assert.equal(ledger.delta, 100); assert.equal(ledger.type, 'GRANT'); assert.equal(ledger.activityType, 'avatar_event');
    assert.equal(paid.question.avatarEvent.rewardedBy, 'teacher');
    resetMetrics(); const exactReplay = await api.manageGongsinmoongo(req);
    assert.equal(exactReplay.reward.awarded, false); assert.equal(metrics().writes, 0);
    resetMetrics(); const replays = await Promise.all(Array.from({ length: 20 }, () => command('admin', 'rewardAvatar', { questionId: question.id, expectedRevision: 1 })));
    assert(replays.every(value => value.replayed && !value.reward.awarded)); assert.equal(metrics().writes, 0);
    counts.avatarPaidRetry = { ...metrics(), calls: 20 };
    assert.equal(await ledgerCount(), 1); assert.equal((await get(accountPath)).balance, 600);
  });
  await check('avatar event: twenty simultaneous first approvals with different teacher/request IDs commit one 100 Wis grant', async () => {
    await seedEvent(); const { question } = await command('a', 'submitAvatar', submission); resetMetrics();
    const values = await Promise.all(Array.from({ length: 20 }, (_, index) => command(index % 2 ? 'teacher' : 'admin', 'rewardAvatar', { questionId: question.id, expectedRevision: 1 })));
    assert.equal(values.filter(value => value.reward.awarded).length, 1);
    assert.equal((await get(accountPath)).balance, 600); assert.equal(await ledgerCount(), 1);
    assert.equal((await db.collection(`${root}/gongsinmoongo_receipts`).get()).size, 2);
    counts.avatarConcurrentReward = { ...metrics(), calls: 20, committedLedgerEntries: 1, awardedWis: 100 };
  });
  await check('avatar event: current active semester can show prior participation and cannot submit again after semester changes', async () => {
    await seedEvent(); const first = await command('a', 'submitAvatar', submission);
    const next = '2027-1', nextRoot = 'years/2027/semesters/1';
    const rows = {
      'site_settings/semester_active': { semesterId: next, revision: 1 },
      [`semester_manifests/${next}`]: { semesterId: next, status: 'ACTIVE', revision: 1 },
      [`semester_enrollment_slots/${buildEnrollmentSlotId(next, 'a')}`]: { semesterId: next, studentUid: 'a', activeEnrollmentId: 'en_next_a', status: 'ACTIVE' },
      'semester_enrollments/en_next_a': { enrollmentId: 'en_next_a', semesterId: next, studentUid: 'a', classId: 'class_next', enrollmentStatus: 'ACTIVE' },
      'semester_classes/class_next': { classId: 'class_next', semesterId: next, status: 'ACTIVE' },
      [`${nextRoot}/gongsinmoongo_config/settings`]: { ...defaultSettings(), enabled: true, avatarEvent: { enabled: true, rewardWis: 200 } },
    };
    await Promise.all(Object.entries(rows).map(([path, value]) => db.doc(path).set(value)));
    resetMetrics(); const state = await query('a', 'avatar-event', { semesterId: next });
    assert.equal(state.submission.semesterId, scope); assert.equal(state.submission.questionId, first.question.id);
    const duplicate = await command('a', 'submitAvatar', { ...submission, semesterId: next });
    assert.equal(duplicate.replayed, true); assert.equal(metrics().writes, 0);
    assert.equal((await db.collection(`${nextRoot}/gongsinmoongo_questions`).get()).size, 0);
    await db.doc(`${root}/gongsinmoongo_questions/${first.question.id}`).delete();
    const orphan = await query('a', 'avatar-event', { semesterId: next }); assert.equal(orphan.participated, true); assert.equal(orphan.submission, undefined);
  });
  await check('avatar event: role, disabled gates, student restriction, menu closure, revision and client snapshot spoofing fail before writes', async () => {
    const saved = await seedEvent();
    await assert.rejects(command('teacher', 'submitAvatar', submission), reason('GONGSIN_STUDENT_REQUIRED'));
    await assert.rejects(command('a', 'rewardAvatar', { questionId: 'fake', expectedRevision: 1 }), reason('GONGSIN_TEACHER_REQUIRED'));
    await assert.rejects(query('teacher', 'avatar-event'), reason('GONGSIN_STUDENT_REQUIRED'));
    for (const injected of [{ rewardWis: 900 }, { thumbnailUrl: saved.thumbnailUrl }, { studentId: 'b' }, { source: { kind: 'avatar' } }, { look: saved.look }])
      await assert.rejects(command('a', 'submitAvatar', { ...submission, ...injected }), reason('GONGSIN_INPUT_INVALID'));
    await assert.rejects(command('a', 'submitAvatar', { ...submission, expectedAvatarRevision: 2 }), reason('GONGSIN_AVATAR_CHANGED'));
    await assert.rejects(command('a', 'submitAvatar', { ...submission, description: '' }), reason('GONGSIN_INPUT_INVALID'));
    await db.doc(settingsPath).update({ avatarEvent: { enabled: false, rewardWis: 100 } });
    await assert.rejects(command('a', 'submitAvatar', submission), reason('GONGSIN_AVATAR_EVENT_CLOSED'));
    await db.doc(settingsPath).update({ avatarEvent: { enabled: true, rewardWis: 100 }, enabled: false });
    await assert.rejects(command('a', 'submitAvatar', submission), reason('GONGSIN_CLOSED'));
    await db.doc(settingsPath).update({ enabled: true });
    await db.doc('site_settings/config').set({ studentMenuVisibility: { avatar: false } });
    await assert.rejects(command('a', 'submitAvatar', submission), reason('STUDENT_MENU_HIDDEN'));
    await db.doc('site_settings/config').set({ studentMenuVisibility: { avatar: true } });
    await db.doc(`${root}/gongsinmoongo_restrictions/a`).set({ until: now() + 60000 });
    await assert.rejects(command('a', 'submitAvatar', submission), reason('GONGSIN_STUDENT_RESTRICTED'));
    await db.doc(`${root}/gongsinmoongo_restrictions/a`).delete();
    for (const patch of [{ studentUid: 'b' }, { requiresThumbnailRefresh: true }, { thumbnailPath: saved.thumbnailPath.replace(hash('a'), hash('b')) }, { thumbnailUrl: 'https://example.com/x.png' }, { catalogVersion: -1 }]) {
      await db.doc('student_avatars/a').set({ ...saved, ...patch });
      await assert.rejects(command('a', 'submitAvatar', submission), reason('GONGSIN_AVATAR_REQUIRED'));
    }
    await db.doc('student_avatars/a').set(saved);
    await assert.rejects(command('a', 'submit', { question: '일반 경로 위조', source: { kind: 'avatar' } }), reason('GONGSIN_SOURCE_INVALID'));
    assert.equal(metrics().writes, 0); assert.equal(await ledgerCount(), 0);
    // This is an event, so it does not require the learning-question warning.
    await db.doc(`${root}/gongsinmoongo_acknowledgments/a`).delete();
    assert.equal((await command('a', 'submitAvatar', submission)).avatarEvent.participated, true);
  });
  await check('avatar event: staged-write failures rollback submission and reward entirely, retries succeed once', async () => {
    await seedEvent();
    let failPath = 'avatar_event_participations/';
    const failingDb = { ...instrumented, runTransaction: (body, options) => instrumented.runTransaction(tx => body({ ...tx,
      create(ref, ...args) { if (ref.path.startsWith(failPath)) throw new Error('synthetic atomic rollback'); return tx.create(ref, ...args); },
      set(ref, ...args) { if (ref.path.startsWith(failPath)) throw new Error('synthetic atomic rollback'); return tx.set(ref, ...args); },
    }), options) };
    const failing = createGongsinmoongoHandlers({ db: failingDb, now });
    await assert.rejects(failing.manageGongsinmoongo(request('a', { action: 'submitAvatar', requestId: randomUUID(), ...submission })), /synthetic atomic rollback/);
    assert.equal((await db.collection(`${root}/gongsinmoongo_questions`).get()).size, 0);
    assert.equal((await db.collection(`${root}/gongsinmoongo_receipts`).get()).size, 0);
    const { question } = await command('a', 'submitAvatar', submission);
    await assert.rejects(failing.manageGongsinmoongo(request('teacher', { action: 'rewardAvatar', requestId: randomUUID(), questionId: question.id, expectedRevision: 1 })), /synthetic atomic rollback/);
    assert.equal((await get(accountPath)).balance, 500); assert.equal(await ledgerCount(), 0);
    assert.equal((await get(participationPath('a'))).rewardedAt, undefined);
    assert.equal((await get(`${root}/gongsinmoongo_questions/${question.id}`)).revision, 1);
    assert.equal((await command('teacher', 'rewardAvatar', { questionId: question.id, expectedRevision: 1 })).reward.amount, 100);
  });
  await check('avatar event: public curated story never exposes snapshot, and cleanup keeps lifetime marker', async () => {
    await seedEvent(); const { question } = await command('a', 'submitAvatar', submission);
    await command('teacher', 'rewardAvatar', { questionId: question.id, expectedRevision: 1 });
    await command('teacher', 'story', { questionId: question.id, expectedRevision: 2, selected: true, publicQuestion: '소개 행사', publicReply: '참여했습니다.' });
    const publicStory = JSON.stringify((await query('b', 'stories')).items);
    for (const forbidden of ['thumbnailUrl', 'avatarEvent', 'studentId', 'look', 'ledgerEntryId', submission.description]) assert(!publicStory.includes(forbidden));
    const refs = await require('../gongsinmoongo').collectGongsinmoongoStudentRefs(db, scope, 'a');
    assert(refs.some(ref => ref.path.endsWith(question.id))); assert(refs.filter(ref => ref.path.includes('gongsinmoongo_receipts')).length >= 3);
    assert(!refs.some(ref => ref.path.startsWith('avatar_event_participations/')));
  });
};
