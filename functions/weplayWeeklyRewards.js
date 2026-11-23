const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');
const { createStudentWisWallet } = require('./studentWisWallet');
const { root, weekAt, weeklyBoardId } = require('./weplayRankingStore');
const { RHYTHM_SONGS } = require('./rhythmRankingCore/rhythmSongs');

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => { throw new HttpsError(code, message); };
const WEEK_MS = 7 * 86400000;
const SETTLEMENT_GRACE_MS = 10 * 60000;
const gameTitles = { 'history-rain': '내가 충무공이라고?!', 'joseon-yut': '윷놀이', 'gungdeok-rock': '덩기덕 쿵더락' };
const scopeFrom = data => {
  if (!/^\d{4}$/.test(data?.year) || !['1', '2'].includes(data?.semester)) fail('invalid-argument', '학기를 확인해 주세요.');
  return { year: data.year, semester: data.semester, id: `${data.year}-${data.semester}` };
};
function selection(data) {
  const { gameId, category, weekId } = data || {};
  if (!Object.hasOwn(gameTitles, gameId || '')) fail('invalid-argument', '게임을 선택해 주세요.');
  const validCategory = gameId === 'joseon-yut' ? category === 'wins' : gameId === 'history-rain'
    ? ['mild', 'medium', 'spicy'].includes(category)
    : RHYTHM_SONGS.some(song => ['normal', 'hard'].some(level => category === `${song.id}:${level}`));
  if (!validCategory) fail('invalid-argument', '보상 랭킹을 선택해 주세요.');
  if (typeof weekId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekId)) fail('invalid-argument', '주차를 선택해 주세요.');
  const timestamp = Date.parse(`${weekId}T00:00:00+09:00`);
  if (!Number.isFinite(timestamp) || weekAt(timestamp).id !== weekId) fail('invalid-argument', '월요일을 기준으로 주차를 선택해 주세요.');
  return { gameId, category, week: weekAt(timestamp) };
}
function normalizeTiers(value) {
  if (!Array.isArray(value) || value.length > 50) fail('invalid-argument', '보상 구간을 확인해 주세요.');
  let previous = 0;
  return value.map(tier => {
    if (!Number.isSafeInteger(tier?.throughRank) || tier.throughRank <= previous || tier.throughRank > 50
      || !Number.isSafeInteger(tier?.wis) || tier.wis < 0 || tier.wis > 100000) fail('invalid-argument', '순위는 1~50위 오름차순, 보상은 0~100,000위스로 입력해 주세요.');
    previous = tier.throughRank;
    return { throughRank: tier.throughRank, wis: tier.wis };
  });
}
const amountForRank = (tiers, rank) => tiers.find(tier => rank <= tier.throughRank)?.wis || 0;
const planIdFor = ({ gameId, category, week }) => weeklyBoardId(gameId, gameId === 'gungdeok-rock' ? `challenge:${category}` : category, '', week.id);
const policyIdFor = ({ gameId, category }) => `${gameId}_${hash(category).slice(0, 40)}`;
const modeFrom = data => {
  const mode = data?.mode || 'week';
  if (!['week', 'recurring'].includes(mode)) fail('invalid-argument', '보상 적용 방식을 확인해 주세요.');
  return mode;
};
const publicRecurring = (selected, policy, currentPlan) => ({ ...publicPlan(selected, policy), mode: 'recurring',
  enabled: policy?.enabled === true, status: policy?.enabled ? 'recurring' : 'disabled',
  manualOverride: Boolean(currentPlan && currentPlan.origin !== 'recurring'), appliesFromWeekId: selected.week.id });
const publicPlan = (selected, plan) => ({ ...selected, tiers: plan?.tiers || [], revision: plan?.revision || 0,
  status: plan?.status || 'unscheduled', paidCount: plan?.paidCount || 0, paidWis: plan?.paidWis || 0,
  skippedCount: plan?.skippedCount || 0, origin: plan?.origin || null, ...(plan?.lastError ? { lastError: plan.lastError } : {}) });

function createWeplayWeeklyRewardHandlers({ db, assertSession = assertScoreWorkflowSession, now = Date.now }) {
  const wallet = createStudentWisWallet({ db, actorUid: 'system:weplay-weekly-rewards' });
  const manager = async (transaction, request, scope, write = false) => {
    const uid = request.auth?.uid;
    if (!uid) fail('unauthenticated', '로그인해 주세요.');
    const email = String(request.auth?.token?.email || '').toLowerCase();
    const [userSnap, configSnap, pointerSnap, manifestSnap] = await transaction.getAll(
      db.doc(`users/${uid}`), db.doc('site_settings/config'), db.doc('site_settings/semester_active'), db.doc(`semester_manifests/${scope.id}`));
    const user = userSnap.data() || {}, config = configSnap.data() || {}, pointer = pointerSnap.data() || {}, manifest = manifestSnap.data() || {};
    const permitted = email === 'westoria28@gmail.com' || (/@yongshin-ms\.ms\.kr$/.test(email)
      && (user.role === 'teacher' || (!write && user.role === 'staff' && user.teacherPortalEnabled === true
        && Array.isArray(user.staffPermissions) && user.staffPermissions.includes('lesson_read'))));
    if (!permitted || user.deletedAt || user.isDeleted || user.weplayDeletionPending
      || (user.registrationApprovalStatus !== undefined && user.registrationApprovalStatus !== 'APPROVED')) fail('permission-denied', '위플레이 관리 권한이 필요합니다.');
    if (String(config.year) !== scope.year || String(config.semester) !== scope.semester || pointer.semesterId !== scope.id
      || manifest.status !== 'ACTIVE' || manifest.readOnly === true || !Number.isSafeInteger(manifest.revision)
      || manifest.revision < 1 || pointer.revision !== manifest.revision) fail('failed-precondition', '현재 운영 학기를 확인해 주세요.');
    return uid;
  };
  const getWeplayWeeklyRewards = async request => {
    await assertSession(request);
    const scope = scopeFrom(request.data), selected = selection(request.data), mode = modeFrom(request.data);
    if (mode === 'recurring') selected.week = weekAt(now());
    return db.runTransaction(async transaction => {
      await manager(transaction, request, scope);
      if (mode === 'recurring') {
        const [policy, plan] = await transaction.getAll(db.doc(`${root(scope)}/weplay_weekly_reward_policies/${policyIdFor(selected)}`),
          db.doc(`${root(scope)}/weplay_weekly_rewards/${planIdFor(selected)}`));
        return publicRecurring(selected, policy.data(), plan.data());
      }
      const snapshot = await transaction.get(db.doc(`${root(scope)}/weplay_weekly_rewards/${planIdFor(selected)}`));
      return publicPlan(selected, snapshot.data());
    }, { readOnly: true });
  };
  const saveWeplayWeeklyRewards = async request => {
    await assertSession(request);
    const scope = scopeFrom(request.data), selected = selection(request.data), tiers = normalizeTiers(request.data.tiers), mode = modeFrom(request.data);
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(request.data?.requestId || '') || !Number.isSafeInteger(request.data.revision) || request.data.revision < 0) fail('invalid-argument', '저장 요청을 확인해 주세요.');
    const atMs = now(), currentWeek = weekAt(atMs), id = planIdFor(selected);
    if (mode === 'recurring') {
      if (selected.week.id !== currentWeek.id || typeof request.data.enabled !== 'boolean') fail('failed-precondition', '이번 주의 반복 설정을 다시 불러와 주세요.');
      const policyId = policyIdFor(selected), policyRef = db.doc(`${root(scope)}/weplay_weekly_reward_policies/${policyId}`);
      const recurringQueue = db.doc(`weplay_weekly_reward_queue/recurring_${hash(`${scope.id}/${policyId}`)}`);
      const planRef = db.doc(`${root(scope)}/weplay_weekly_rewards/${id}`);
      const planQueue = db.doc(`weplay_weekly_reward_queue/${hash(`${scope.id}/${id}`)}`);
      return db.runTransaction(async transaction => {
        const uid = await manager(transaction, request, scope, true);
        const receiptRef = db.doc(`${root(scope)}/weplay_weekly_reward_commands/${hash(`${uid}/${request.data.requestId}`)}`);
        const [policySnap, receiptSnap, planSnap] = await transaction.getAll(policyRef, receiptRef, planRef);
        const previous = policySnap.data(), currentPlan = planSnap.data(), enabled = request.data.enabled;
        const requestHash = hash(JSON.stringify({ mode, id, enabled, tiers, revision: request.data.revision }));
        if (receiptSnap.exists) {
          if (receiptSnap.data().requestHash !== requestHash) fail('invalid-argument', '같은 저장 요청의 내용을 바꿀 수 없습니다.');
          return publicRecurring(selected, previous, currentPlan);
        }
        if ((previous?.revision || 0) !== request.data.revision) fail('aborted', '설정이 변경되었습니다. 다시 불러와 주세요.');
        if (Boolean(previous?.enabled) === enabled && JSON.stringify(previous?.tiers || []) === JSON.stringify(tiers)) return publicRecurring(selected, previous, currentPlan);
        if (enabled && !tiers.some(tier => tier.wis > 0)) fail('invalid-argument', '매주 지급할 위스를 입력해 주세요.');
        const revision = (previous?.revision || 0) + 1;
        // A changed setting only replaces this week's version. Older versions
        // stay immutable so a delayed cursor cannot pay old weeks at new rates.
        const versions = [...(previous?.versions || []).filter(version => version.startsAtMs < currentWeek.startsAtMs),
          { startsAtMs: currentWeek.startsAtMs, enabled, tiers, revision }];
        const nextWeekStartsAtMs = Math.min(previous?.nextWeekStartsAtMs ?? currentWeek.endsAtMs, currentWeek.endsAtMs);
        const policy = { gameId: selected.gameId, category: selected.category, enabled, tiers, revision, versions,
          nextWeekStartsAtMs, updatedAtMs: atMs, updatedBy: uid };
        transaction.set(policyRef, policy);
        transaction.create(receiptRef, { requestHash, policyId, revision, actorUid: uid, mode, createdAtMs: atMs });
        // Explicit weekly plans always win, including a manual zero reward.
        if (!currentPlan || currentPlan.origin === 'recurring' && !['paid', 'settling'].includes(currentPlan.status)) {
          const plan = { ...selected, tiers, revision: (currentPlan?.revision || 0) + 1,
            status: enabled ? 'scheduled' : 'disabled', origin: 'recurring', policyRevision: revision, updatedAtMs: atMs, updatedBy: uid };
          transaction.set(planRef, plan);
          if (enabled) transaction.set(planQueue, { scope, planId: id, dueAtMs: currentWeek.endsAtMs + SETTLEMENT_GRACE_MS });
          else transaction.delete(planQueue);
        }
        if (enabled || nextWeekStartsAtMs < currentWeek.startsAtMs) transaction.set(recurringQueue,
          { kind: 'recurring', scope, policyId, dueAtMs: nextWeekStartsAtMs });
        else transaction.delete(recurringQueue);
        return publicRecurring(selected, policy, currentPlan);
      });
    }
    if (selected.week.endsAtMs <= atMs || selected.week.startsAtMs > currentWeek.startsAtMs + WEEK_MS * 52) fail('failed-precondition', '이번 주부터 1년 이내의 주차만 설정할 수 있습니다.');
    const ref = db.doc(`${root(scope)}/weplay_weekly_rewards/${id}`);
    const queue = db.doc(`weplay_weekly_reward_queue/${hash(`${scope.id}/${id}`)}`);
    return db.runTransaction(async transaction => {
      const uid = await manager(transaction, request, scope, true);
      const receiptRef = db.doc(`${root(scope)}/weplay_weekly_reward_commands/${hash(`${uid}/${request.data.requestId}`)}`);
      const [snapshot, receiptSnap] = await transaction.getAll(ref, receiptRef);
      const previous = snapshot.data(), requestHash = hash(JSON.stringify({ id, tiers, revision: request.data.revision }));
      if (receiptSnap.exists) {
        if (receiptSnap.data().requestHash !== requestHash) fail('invalid-argument', '같은 저장 요청의 내용을 바꿀 수 없습니다.');
        return publicPlan(selected, previous);
      }
      if (previous?.status === 'settling' || previous?.status === 'paid' || (previous?.revision || 0) !== request.data.revision) fail('aborted', '설정이 변경되었습니다. 다시 불러와 주세요.');
      if (previous?.origin !== 'recurring' && JSON.stringify(previous?.tiers || []) === JSON.stringify(tiers)) return publicPlan(selected, previous);
      const plan = { ...selected, tiers, revision: (previous?.revision || 0) + 1,
        status: tiers.some(tier => tier.wis > 0) ? 'scheduled' : 'disabled', updatedAtMs: atMs, updatedBy: uid };
      transaction.set(ref, plan);
      transaction.create(receiptRef, { requestHash, planId: id, revision: plan.revision, actorUid: uid, createdAtMs: atMs });
      if (plan.status === 'scheduled') transaction.set(queue, { scope, planId: id, dueAtMs: selected.week.endsAtMs + SETTLEMENT_GRACE_MS });
      else transaction.delete(queue);
      return publicPlan(selected, plan);
    });
  };
  const expandRecurringPlan = async queueRef => db.runTransaction(async transaction => {
    const atMs = now(), queued = (await transaction.get(queueRef)).data();
    if (!queued || queued.kind !== 'recurring' || queued.dueAtMs > atMs) return;
    const scope = scopeFrom(queued.scope), policyRef = db.doc(`${root(scope)}/weplay_weekly_reward_policies/${queued.policyId}`);
    const [policySnap, configSnap, pointerSnap, manifestSnap] = await transaction.getAll(policyRef,
      db.doc('site_settings/config'), db.doc('site_settings/semester_active'), db.doc(`semester_manifests/${scope.id}`));
    const policy = policySnap.data(), config = configSnap.data() || {}, pointer = pointerSnap.data() || {}, manifest = manifestSnap.data() || {};
    if (!policy || String(config.year) !== scope.year || String(config.semester) !== scope.semester || pointer.semesterId !== scope.id
      || manifest.status !== 'ACTIVE' || manifest.readOnly === true || !Number.isSafeInteger(manifest.revision)
      || manifest.revision < 1 || pointer.revision !== manifest.revision) {
      transaction.delete(queueRef); return;
    }
    const week = weekAt(policy.nextWeekStartsAtMs), selected = selection({ ...policy, weekId: week.id });
    if (week.startsAtMs > atMs) return;
    const version = [...policy.versions].reverse().find(value => value.startsAtMs <= week.startsAtMs);
    const id = planIdFor(selected), planRef = db.doc(`${root(scope)}/weplay_weekly_rewards/${id}`);
    const planSnap = await transaction.get(planRef);
    if (!planSnap.exists && version?.enabled) {
      transaction.create(planRef, { ...selected, tiers: version.tiers, revision: 1, status: 'scheduled', origin: 'recurring',
        policyRevision: version.revision, updatedAtMs: atMs, updatedBy: 'system:weplay-weekly-rewards' });
      transaction.set(db.doc(`weplay_weekly_reward_queue/${hash(`${scope.id}/${id}`)}`),
        { scope, planId: id, dueAtMs: week.endsAtMs + SETTLEMENT_GRACE_MS });
    }
    transaction.update(policyRef, { nextWeekStartsAtMs: week.endsAtMs, lastError: null });
    if (!policy.enabled && week.endsAtMs >= weekAt(atMs).startsAtMs) transaction.delete(queueRef);
    else transaction.update(queueRef, { dueAtMs: week.endsAtMs });
  });
  const settlePlan = async queueRef => {
    const atMs = now();
    const frozen = await db.runTransaction(async transaction => {
      const queued = (await transaction.get(queueRef)).data();
      if (!queued || queued.dueAtMs > atMs) return null;
      const scope = scopeFrom(queued.scope), ref = db.doc(`${root(scope)}/weplay_weekly_rewards/${queued.planId}`);
      const plan = (await transaction.get(ref)).data();
      if (!plan || ['paid', 'disabled'].includes(plan.status)) { transaction.delete(queueRef); return null; }
      if (plan.week.endsAtMs + SETTLEMENT_GRACE_MS > atMs) return null;
      if (plan.status === 'settling') return { scope, ref, plan };
      const board = (await transaction.get(db.doc(`${root(scope)}/weplay_weekly_rankings/${queued.planId}`))).data();
      const winners = (board?.rows || []).slice(0, 50).map((row, index) => ({ uid: row.uid, rank: index + 1, wis: amountForRank(plan.tiers, index + 1) }))
        .filter(winner => winner.wis > 0);
      if (winners.some(winner => !/^[a-zA-Z0-9_-]{1,128}$/.test(winner.uid)) || new Set(winners.map(winner => winner.uid)).size !== winners.length) fail('failed-precondition', '주간 순위 자료를 확인해 주세요.');
      const next = { ...plan, winners, status: 'settling', frozenAtMs: atMs };
      transaction.update(ref, { winners, status: 'settling', frozenAtMs: atMs });
      return { scope, ref, plan: next };
    });
    if (!frozen) return;
    const { scope, ref, plan } = frozen;
    let paidCount = 0, paidWis = 0, skippedCount = 0;
    const failures = [];
    for (const winner of plan.winners) {
      try {
      const result = await db.runTransaction(async transaction => {
        const sourceId = `${ref.id}_${winner.uid}`;
        const receiptRef = db.doc(`${root(scope)}/point_transactions/weplay_weekly_reward_${sourceId}`);
        const receiptSnap = await transaction.get(receiptRef);
        if (receiptSnap.exists) return receiptSnap.data();
        const profileSnap = await transaction.get(db.doc(`users/${winner.uid}`));
        const profile = profileSnap.data();
        // Removed accounts are explicitly recorded as skipped, never paid to a
        // replacement student. Other wallet/semester failures remain retryable.
        if (!profile || profile.role !== 'student' || profile.isDeleted || profile.deletedAt || profile.weplayDeletionPending
          || (profile.registrationApprovalStatus !== undefined && profile.registrationApprovalStatus !== 'APPROVED')) {
          const result = { status: 'skipped', rank: winner.rank, amount: 0, reason: 'inactive-account', createdAtMs: atMs };
          transaction.create(receiptRef, result); return result;
        }
        const loaded = await wallet.read(transaction, scope, winner.uid);
        const balanceAfter = wallet.write(transaction, scope, winner.uid, winner.wis, 'weplay_weekly_reward', sourceId,
          `${gameTitles[plan.gameId]} ${plan.week.id} 주간 전체 ${winner.rank}위`, loaded, receiptRef.path);
        const result = { status: 'paid', rank: winner.rank, amount: winner.wis, uid: winner.uid, gameId: plan.gameId,
          category: plan.category, weekId: plan.week.id, policyRevision: plan.revision, canonical: true,
          delta: winner.wis, balanceAfter, createdAtMs: atMs };
        transaction.create(receiptRef, result); return result;
      });
      if (result.status === 'paid') { paidCount++; paidWis += result.amount; } else skippedCount++;
      } catch (error) { failures.push(error); }
    }
    // A blocked account never prevents later winners from receiving their award.
    // Keep this plan queued until every unreceipted winner can be settled.
    if (failures.length) throw failures[0];
    await db.runTransaction(async transaction => {
      const latest = (await transaction.get(ref)).data();
      if (latest?.status === 'paid') return;
      if (latest?.status !== 'settling' || latest.revision !== plan.revision) fail('aborted', '보상 설정을 다시 확인해 주세요.');
      transaction.update(ref, { status: 'paid', paidCount, paidWis, skippedCount, completedAtMs: now(), lastError: null });
      transaction.delete(queueRef);
    });
  };
  const settleWeplayWeeklyRewards = async () => {
    // Four due plans per execution bound runtime; the durable queue retains all
    // remaining work for the next run, so no winner or week is truncated.
    const due = await db.collection('weplay_weekly_reward_queue').where('dueAtMs', '<=', now()).orderBy('dueAtMs').limit(4).get();
    const report = { plans: due.size, completed: 0, failed: 0 };
    for (const document of due.docs) {
      try {
        if (document.data().kind === 'recurring') await expandRecurringPlan(document.ref);
        else await settlePlan(document.ref);
        report.completed++;
      }
      catch (error) {
        report.failed++;
        const queued = document.data(), scope = scopeFrom(queued.scope);
        await db.runTransaction(async transaction => {
          const current = await transaction.get(document.ref);
          if (!current.exists) return;
          transaction.update(document.ref, { dueAtMs: now() + 15 * 60000 });
          const path = queued.kind === 'recurring' ? `weplay_weekly_reward_policies/${queued.policyId}` : `weplay_weekly_rewards/${queued.planId}`;
          transaction.update(db.doc(`${root(scope)}/${path}`), { lastError: String(error.code || 'internal').slice(0, 80) });
        });
        console.error('Weekly Weplay settlement deferred', { code: error.code || 'internal' });
      }
    }
    return report;
  };
  return { getWeplayWeeklyRewards, saveWeplayWeeklyRewards, settleWeplayWeeklyRewards, settlePlan, expandRecurringPlan };
}
module.exports = { createWeplayWeeklyRewardHandlers, normalizeTiers, amountForRank, selection, planIdFor, policyIdFor, SETTLEMENT_GRACE_MS };
