const {
  TOTAL_WORDS, START_DELAY_MS, PERIOD_SETTLEMENT_DELAY_MS, DIFFICULTIES,
  hash, validatePolicy, readPolicy, effectiveLessons, extractLessonWords,
  buildWords, assessAnswer, gameReward, periodBounds, compareEntries,
  GAME_ID, validateUnitIds, validateGameSettings, readGameSettings, uniqueWordCount,
  DEFAULT_DIFFICULTY_SETTINGS, readDifficulties, gameCatalog, filterDifficultyWords,
} = require('./weplayCore');
const { simulateWeplayBattle } = require('./weplayBattle');
const { randomUUID } = require('node:crypto');

// The existing point wallet, transaction, permission, and rank helpers are injected
// so games use exactly the same semester ledger as the rest of Westory.
function createWeplayFunctions(deps) {
  const {
    db, onCall, onSchedule, HttpsError, FieldValue, REGION,
    assertAllowedWestoryUser, assertPointManager, assertPointReader, getUserProfile,
    assertWeplayReader, assertWeplayManager,
    ensureWallet, loadPolicy, getCurrentRankEarnedTotal, buildWalletBase,
    buildWalletRankState, createTransactionPayload, markWisHallOfFameDirtySafely,
  } = deps;
  const path = (scope, collection, id) => `years/${scope.year}/semesters/${scope.semester}/${collection}${id ? `/${id}` : ''}`;
  const ref = (scope, collection, id) => db.doc(path(scope, collection, id));
  const dayKey = (now = Date.now()) => new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  const invalid = (message) => { throw new HttpsError('invalid-argument', message); };
  const identifier = (value, field) => {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) invalid(`${field} 값이 올바르지 않습니다.`);
    return value;
  };
  const scopeFrom = (data) => ({ year: identifier(data?.year, '학년도'), semester: identifier(data?.semester, '학기') });
  const assertGameId = (data) => {
    if (data?.gameId !== GAME_ID) invalid('지원하지 않는 게임입니다.');
  };
  const assertCurrentScope = async (scope) => {
    const config = (await db.doc('site_settings/config').get()).data();
    if (!config || String(config.year) !== scope.year || String(config.semester) !== scope.semester) {
      throw new HttpsError('failed-precondition', '현재 운영 중인 학기에서 이용해 주세요.');
    }
  };
  const student = async (request) => {
    const { uid } = assertAllowedWestoryUser(request);
    const { profile } = await getUserProfile(uid);
    if (profile.role !== 'student' || profile.isDeleted === true || profile.deletedAt || profile.weplayDeletionPending === true) {
      throw new HttpsError('permission-denied', '학생 계정으로 이용해 주세요.');
    }
    return { uid, profile };
  };
  const completeWeplayGuide = onCall({ region: REGION }, async (request) => {
    const { uid } = assertAllowedWestoryUser(request);
    // accountUid is only a stale-account guard; it never chooses a write target.
    if (request.data?.accountUid !== uid) {
      throw new HttpsError('permission-denied', '로그인 계정이 변경되었습니다. 다시 확인해 주세요.');
    }
    return db.runTransaction(async (transaction) => {
      const userRef = db.doc(`users/${uid}`);
      const snapshot = await transaction.get(userRef);
      if (!snapshot.exists) throw new HttpsError('failed-precondition', '사용자 정보를 확인하지 못했습니다. 다시 로그인해 주세요.');
      const profile = snapshot.data();
      const allowed = profile.role === 'student' || profile.role === 'teacher'
        || (profile.role === 'staff' && profile.teacherPortalEnabled === true && Array.isArray(profile.staffPermissions) && profile.staffPermissions.includes('lesson_read'));
      if (!allowed || profile.isDeleted === true || profile.deletedAt || profile.weplayDeletionPending === true) {
        throw new HttpsError('permission-denied', '위플레이를 이용할 수 있는 계정으로 로그인해 주세요.');
      }
      if (profile.weplayGuideCompleted !== true) {
        transaction.update(userRef, { weplayGuideCompleted: true, weplayGuideCompletedAt: FieldValue.serverTimestamp() });
      }
      return { uid, guideCompleted: true };
    });
  });
  const classKey = (profile) => {
    const grade = String(profile.studentGrade || profile.grade || '').trim().replace(/학년$/, '').trim();
    const className = String(profile.studentClass || profile.class || '').trim().replace(/반$/, '').trim();
    return /^\d{1,3}$/.test(grade) && /^\d{1,3}$/.test(className) ? `${Number(grade)}-${Number(className)}` : '';
  };
  const studentLabel = (profile) => {
    const name = String(profile.name || profile.studentName || '').trim();
    const number = String(profile.studentNumber || profile.number || '').replace(/[^0-9]/g, '').slice(0, 3);
    return `${number ? `${number}번 ` : ''}${name ? `${name[0]}${'○'.repeat(Math.min(3, Math.max(1, name.length - 1)))}` : '학생'}`;
  };
  const policyFromSnap = (snapshot) => {
    try { return readPolicy(snapshot.exists ? snapshot.data() : null); }
    catch { throw new HttpsError('failed-precondition', '위플레이 운영 정책을 확인해 주세요.'); }
  };
  const settingsFromSnap = (snapshot) => {
    try { return readGameSettings(snapshot.exists ? snapshot.data() : null); }
    catch { throw new HttpsError('failed-precondition', '위플레이 게임 설정을 확인해 주세요.'); }
  };
  const publicPeriod = (data) => data ? ({
    id: data.id, startsAtMs: data.startsAtMs, endsAtMs: data.endsAtMs,
    rankingPeriod: data.rankingPeriod, rankingRewards: data.rankingRewards,
    status: data.status === 'closed' ? 'closed' : 'open',
  }) : null;
  const publicSession = (data) => ({
    id: data.id, mode: data.mode, difficulty: data.difficulty, status: data.status,
    startsAtMs: data.startsAtMs, endsAtMs: data.endsAtMs, words: data.words,
    acceptedWordIds: data.acceptedWordIds || [], correctCount: data.words.filter((word) => word.kind !== 'special' && (data.acceptedWordIds || []).includes(word.id)).length,
    policy: data.policy, result: data.result || null, serverNowMs: Date.now(),
    difficultySettings: data.difficultySettings || DEFAULT_DIFFICULTY_SETTINGS[data.difficulty],
    ...(data.battleVersion === 1 ? { battleVersion: 1, acceptedEvents: data.acceptedEvents || [], battle: simulateWeplayBattle(data, Date.now() - data.startsAtMs) } : {}),
  });

  async function readLessons(scope, includeHidden = false) {
    const [scoped, legacy] = await Promise.all([
      db.collection(path(scope, 'lessons')).get(), db.collection('lessons').get(),
    ]);
    return effectiveLessons(scoped.docs.map((doc) => doc.data()), legacy.docs.map((doc) => doc.data()), { includeHidden });
  }

  async function readCatalog(scope) {
    const [settingsSnap, lessons] = await Promise.all([
      ref(scope, 'weplay_games', GAME_ID).get(), readLessons(scope),
    ]);
    const settings = settingsFromSnap(settingsSnap);
    return { settings, catalog: gameCatalog(lessons, settings) };
  }

  const managementPayload = (settings, lessons) => {
    return {
      settings,
      lessons: lessons.map((lesson) => {
        const words = extractLessonWords([lesson]);
        return { unitId: String(lesson.unitId || '').trim(), title: String(lesson.title || '').trim().slice(0, 120), isVisibleToStudents: lesson.isVisibleToStudents !== false, wordCount: words.length, words: words.map((word) => word.text) };
      }),
      availableWordCount: uniqueWordCount(gameCatalog(lessons.filter((lesson) => lesson.isVisibleToStudents !== false), settings)),
      previewWordCount: uniqueWordCount(gameCatalog(lessons, settings)),
    };
  };

  const assertKnownUnits = (unitIds, lessons) => {
    const known = new Set(lessons.map((lesson) => String(lesson.unitId || '').trim()));
    if (unitIds.some((unitId) => !known.has(unitId))) invalid('선택한 수업 자료가 변경되었습니다. 목록을 새로 불러와 주세요.');
  };

  const getWeplayManagement = onCall({ region: REGION }, async (request) => {
    await assertWeplayReader(request);
    const scope = scopeFrom(request.data);
    assertGameId(request.data);
    const [settingsSnap, lessons] = await Promise.all([
      ref(scope, 'weplay_games', GAME_ID).get(), readLessons(scope, true),
    ]);
    return managementPayload(settingsFromSnap(settingsSnap), lessons);
  });

  const saveWeplayGameSettings = onCall({ region: REGION }, async (request) => {
    const manager = await assertWeplayManager(request);
    const scope = scopeFrom(request.data);
    assertGameId(request.data);
    await assertCurrentScope(scope);
    let validated;
    try { validated = validateGameSettings(request.data?.settings); }
    catch (error) { invalid(error.message); }
    const expectedVersion = request.data?.settings?.version;
    if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) invalid('설정 버전을 확인해 주세요.');
    const lessons = await readLessons(scope, true);
    assertKnownUnits(validated.unitIds, lessons);
    const settings = await db.runTransaction(async (transaction) => {
      const settingsRef = ref(scope, 'weplay_games', GAME_ID);
      const previous = settingsFromSnap(await transaction.get(settingsRef));
      if (expectedVersion !== undefined && expectedVersion !== previous.version) {
        throw new HttpsError('aborted', '다른 곳에서 게임 설정을 수정했습니다. 새로 불러온 뒤 저장해 주세요.');
      }
      const updated = { ...validated, version: previous.version + 1 };
      transaction.set(settingsRef, { ...updated, updatedAt: FieldValue.serverTimestamp(), updatedBy: manager.uid });
      return updated;
    });
    return managementPayload(settings, lessons);
  });

  const previewWeplayGame = onCall({ region: REGION }, async (request) => {
    await assertWeplayReader(request);
    const scope = scopeFrom(request.data);
    assertGameId(request.data);
    const difficulty = request.data?.difficulty;
    if (!DIFFICULTIES.includes(difficulty)) invalid('게임 난이도를 선택해 주세요.');
    const [settingsSnap, policySnap, lessons] = await Promise.all([
      ref(scope, 'weplay_games', GAME_ID).get(), ref(scope, 'weplay_policies', 'current').get(), readLessons(scope, true),
    ]);
    let previewSettings = settingsFromSnap(settingsSnap);
    if (request.data?.settings !== undefined) {
      try { previewSettings = validateGameSettings(request.data.settings); }
      catch (error) { invalid(error.message); }
      assertKnownUnits(previewSettings.unitIds, lessons);
    } else if (request.data?.unitIds !== undefined) {
      let unitIds;
      try { unitIds = validateUnitIds(request.data.unitIds); }
      catch (error) { invalid(error.message); }
      assertKnownUnits(unitIds, lessons);
      previewSettings = { ...previewSettings, sourceMode: 'selected', unitIds };
    }
    const id = `preview_${randomUUID()}`;
    let words;
    const difficultySettings = previewSettings.difficulties[difficulty];
    try { words = buildWords(gameCatalog(lessons, previewSettings), id, difficulty, difficultySettings, previewSettings); }
    catch (error) { throw new HttpsError('failed-precondition', error.message); }
    const startsAtMs = Date.now() + START_DELAY_MS;
    // Preview sessions never enter Firestore, the settlement queues, or the ledger.
    return publicSession({ id, mode: 'practice', difficulty, difficultySettings, status: 'active', startsAtMs, endsAtMs: startsAtMs + difficultySettings.durationSeconds * 1000, words, acceptedWordIds: [], battleVersion: 1, acceptedEvents: [], policy: policyFromSnap(policySnap), result: null });
  });

  async function ensurePeriod(scope) {
    return db.runTransaction(async (transaction) => {
      const policy = policyFromSnap(await transaction.get(ref(scope, 'weplay_policies', 'current')));
      const metaRef = ref(scope, 'weplay_meta', 'current');
      const meta = (await transaction.get(metaRef)).data() || {};
      const current = meta.periodId ? (await transaction.get(ref(scope, 'weplay_periods', meta.periodId))).data() : null;
      const now = Date.now();
      if (current && current.endsAtMs > now && current.status === 'open' && current.battleVersion === 1) return { ...current, difficulties: readDifficulties(current.difficulties) };
      // Old rain scores and promised podium awards remain in their original period.
      // Naval combat gets a separate period; never reinterpret existing entries.
      const migrating = current && current.endsAtMs > now && current.battleVersion !== 1;
      const bounds = migrating ? { startsAtMs: now, endsAtMs: current.endsAtMs } : periodBounds(now, policy.rankingPeriod, current?.endsAtMs || 0);
      const id = `period_${bounds.startsAtMs}_naval_v1`;
      const periodRef = ref(scope, 'weplay_periods', id);
      const existing = await transaction.get(periodRef);
      if (existing.exists) return existing.data();
      const settings = settingsFromSnap(await transaction.get(ref(scope, 'weplay_games', GAME_ID)));
      const period = { id, ...bounds, battleVersion: 1, rankingPeriod: migrating ? current.rankingPeriod : policy.rankingPeriod, rankingRewards: migrating ? current.rankingRewards : policy.rankingRewards, policyVersion: migrating ? current.policyVersion : policy.version, difficulties: settings.difficulties, status: 'open', createdAt: FieldValue.serverTimestamp() };
      transaction.create(periodRef, period);
      transaction.set(metaRef, { periodId: id }, { merge: true });
      transaction.set(db.doc(`weplay_period_queue/${hash(`${scope.year}:${scope.semester}:${id}`)}`), {
        ...scope, periodId: id, dueAtMs: period.endsAtMs + PERIOD_SETTLEMENT_DELAY_MS,
      });
      return period;
    });
  }

  async function writePointChange(transaction, scope, uid, profile, delta, type, sourceId, sourceLabel, policyVersion, loaded) {
    // All callers finish their transaction reads before invoking this helper.
    const { walletRef, wallet, pointPolicy, rankTotal } = loaded;
    const balance = Number(wallet.balance || 0) + delta;
    if (!Number.isFinite(balance) || balance < 0) throw new HttpsError('failed-precondition', '보유 위스가 부족합니다.');
    transaction.set(walletRef, {
      ...buildWalletBase(uid, profile), balance,
      earnedTotal: Number(wallet.earnedTotal || 0) + Math.max(0, delta),
      ...buildWalletRankState(rankTotal + Math.max(0, delta), pointPolicy.rankPolicy),
      spentTotal: Number(wallet.spentTotal || 0) + Math.max(0, -delta),
      adjustedTotal: Number(wallet.adjustedTotal || 0),
      lastTransactionAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.create(ref(scope, 'point_transactions', `${type}_${sourceId}`), createTransactionPayload({
      uid, type, delta, balanceAfter: balance, sourceId, sourceLabel,
      policyId: `weplay:${policyVersion}`, createdBy: 'system:weplay', targetDate: dayKey(), targetMonth: dayKey().slice(0, 7),
    }));
    return balance;
  }

  async function loadWallet(transaction, scope, uid, profile) {
    const { ref: walletRef, wallet } = await ensureWallet(transaction, scope.year, scope.semester, uid, profile);
    const pointPolicy = await loadPolicy(transaction, scope.year, scope.semester);
    const rankTotal = await getCurrentRankEarnedTotal(transaction, scope.year, scope.semester, uid, wallet);
    return { walletRef, wallet, pointPolicy, rankTotal };
  }

  async function settleSession(scope, sessionId, ownerUid = null, exitEarly = false) {
    const result = await db.runTransaction(async (transaction) => {
      const sessionRef = ref(scope, 'weplay_sessions', sessionId);
      const sessionSnap = await transaction.get(sessionRef);
      if (!sessionSnap.exists) throw new HttpsError('not-found', '게임 기록을 찾을 수 없습니다.');
      const session = sessionSnap.data();
      if (ownerUid && ownerUid !== session.uid) throw new HttpsError('permission-denied', '본인의 게임만 정산할 수 있습니다.');
      if (session.status === 'finished') return { result: session.result, changed: false };
      const settledAtMs = Date.now();
      const battle = session.battleVersion === 1 ? simulateWeplayBattle(session, settledAtMs - session.startsAtMs) : null;
      const endedEarly = settledAtMs < session.endsAtMs && battle?.outcome !== 'defeat';
      if (endedEarly && !exitEarly) throw new HttpsError('failed-precondition', '게임이 끝난 뒤 정산할 수 있습니다.');
      const playerRef = ref(scope, 'weplay_players', session.uid);
      const player = (await transaction.get(playerRef)).data() || {};
      const currentProfile = (await transaction.get(db.doc(`users/${session.uid}`))).data();
      const eligible = !!currentProfile && currentProfile.role === 'student' && !currentProfile.deletedAt && currentProfile.isDeleted !== true && currentProfile.weplayDeletionPending !== true;
      const accepted = new Set(session.acceptedWordIds || []);
      const correctCount = battle ? battle.normalCorrectCount : session.words.filter((word) => accepted.has(word.id)).length;
      const rewardCorrectCount = battle ? battle.rewardCorrectCount : correctCount;
      const reward = session.mode === 'challenge' && eligible ? gameReward(session.policy, rewardCorrectCount) : 0;
      const loaded = reward > 0
        ? await loadWallet(transaction, scope, session.uid, currentProfile)
        : { wallet: (await transaction.get(ref(scope, 'point_wallets', session.uid))).data() || {} };
      const rewardRef = ref(scope, 'point_transactions', `weplay_reward_${sessionId}`);
      const rewardSnap = await transaction.get(rewardRef);
      const periodRef = session.periodId ? ref(scope, 'weplay_periods', session.periodId) : null;
      const period = periodRef ? (await transaction.get(periodRef)).data() : null;
      const entryRef = periodRef ? periodRef.collection('entries').doc(hash(`${session.uid}:${session.difficulty}`)) : null;
      const entry = entryRef ? (await transaction.get(entryRef)).data() : null;
      const cost = session.mode === 'challenge' ? session.policy.challengeCost : 0;
      let balance = Number(loaded.wallet.balance || 0);
      if (rewardSnap.exists) throw new HttpsError('failed-precondition', '정산 기록을 확인해 주세요.');
      if (reward > 0) balance = await writePointChange(transaction, scope, session.uid, currentProfile, reward, 'weplay_reward', sessionId, `${session.battleVersion === 1 ? '내가 충무공이라고?!' : '역사가 내려와'} 도전 정산`, session.policy.version, loaded);
      const resultData = {
        sessionId, mode: session.mode, difficulty: session.difficulty, correctCount, totalWords: battle ? session.words.filter((word) => word.kind !== 'special').length : TOTAL_WORDS, score: battle ? battle.score : correctCount * 100,
        reward, cost, netWis: reward - cost, balance, finishedAtMs: endedEarly ? settledAtMs : battle?.defeatAtMs !== null && battle?.defeatAtMs !== undefined ? session.startsAtMs + battle.defeatAtMs : session.endsAtMs,
        missedWords: session.words.filter((word) => word.kind !== 'special' && !accepted.has(word.id)),
        ...(endedEarly ? { endedEarly: true } : {}),
        ...(battle ? { battleVersion: 1, battle, rewardCorrectCount } : {}),
      };
      transaction.update(sessionRef, { status: 'finished', result: resultData, settledAt: FieldValue.serverTimestamp() });
      if (eligible) transaction.set(playerRef.collection('records').doc(sessionId), resultData);
      if (eligible && player.activeSessionId === sessionId) transaction.set(playerRef, { activeSessionId: null }, { merge: true });
      transaction.delete(db.doc(`weplay_session_queue/${sessionId}`));
      // Zero-point abandoned games are recorded privately, but never earn a podium.
      if (eligible && session.mode === 'challenge' && resultData.score > 0 && entryRef && period && period.status !== 'closed') {
        const candidate = { uid: session.uid, difficulty: session.difficulty, classKey: session.classKey, studentLabel: session.studentLabel, score: resultData.score, correctCount, achievedAtMs: resultData.finishedAtMs, sessionId };
        if (!entry || compareEntries(candidate, entry) < 0) transaction.set(entryRef, candidate);
      }
      return { result: resultData, changed: reward > 0 };
    });
    if (result.changed) await markWisHallOfFameDirtySafely(scope.year, scope.semester);
    return result.result;
  }

  async function recoverActive(scope, uid) {
    const player = (await ref(scope, 'weplay_players', uid).get()).data() || {};
    if (!player.activeSessionId) return null;
    const session = (await ref(scope, 'weplay_sessions', player.activeSessionId).get()).data();
    if (!session || session.status !== 'active') return null;
    if (Date.now() >= session.endsAtMs + 5000 || (session.battleVersion === 1 && simulateWeplayBattle(session, Date.now() - session.startsAtMs).outcome === 'defeat')) {
      await settleSession(scope, session.id, uid);
      return null;
    }
    return session;
  }

  const getWeplayPolicy = onCall({ region: REGION }, async (request) => {
    await assertPointReader(request);
    const scope = scopeFrom(request.data);
    const [policySnap, metaSnap] = await Promise.all([ref(scope, 'weplay_policies', 'current').get(), ref(scope, 'weplay_meta', 'current').get()]);
    const periodId = metaSnap.data()?.periodId;
    const current = periodId ? (await ref(scope, 'weplay_periods', periodId).get()).data() : null;
    return { policy: policyFromSnap(policySnap), currentRankingPeriod: current && current.endsAtMs > Date.now() ? publicPeriod(current) : null };
  });

  const saveWeplayPolicy = onCall({ region: REGION }, async (request) => {
    const manager = await assertPointManager(request);
    const scope = scopeFrom(request.data);
    await assertCurrentScope(scope);
    let validated;
    try { validated = validatePolicy(request.data?.policy); }
    catch (error) { invalid(error.message); }
    return db.runTransaction(async (transaction) => {
      const policyRef = ref(scope, 'weplay_policies', 'current');
      const previous = await transaction.get(policyRef);
      const meta = (await transaction.get(ref(scope, 'weplay_meta', 'current'))).data();
      const current = meta?.periodId ? (await transaction.get(ref(scope, 'weplay_periods', meta.periodId))).data() : null;
      const policy = { ...validated, version: Number(previous.data()?.version || 0) + 1 };
      transaction.set(policyRef, { ...policy, updatedAt: FieldValue.serverTimestamp(), updatedBy: manager.uid });
      return { policy, currentRankingPeriod: current && current.endsAtMs > Date.now() ? publicPeriod(current) : null };
    });
  });

  const getWeplayLobby = onCall({ region: REGION }, async (request) => {
    const { uid, profile } = await student(request);
    const scope = scopeFrom(request.data);
    await assertCurrentScope(scope);
    const active = await recoverActive(scope, uid);
    const [policySnap, walletSnap, playerSnap, catalogResult, period, recordsSnap] = await Promise.all([
      ref(scope, 'weplay_policies', 'current').get(), ref(scope, 'point_wallets', uid).get(),
      ref(scope, 'weplay_players', uid).get(), readCatalog(scope), ensurePeriod(scope),
      ref(scope, 'weplay_players', uid).collection('records').orderBy('finishedAtMs', 'desc').limit(10).get(),
    ]);
    const { settings, catalog } = catalogResult;
    const challengeDifficulties = readDifficulties(period.difficulties);
    const counts = (words, difficulties) => Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, uniqueWordCount(filterDifficultyWords(words, difficulties[difficulty]))]));
    const policy = policyFromSnap(policySnap);
    const player = playerSnap.data() || {};
    const dailyUsed = player.dateKey === dayKey() ? Number(player.challengeUsed || 0) : 0;
    const lessons = [...new Set(catalog.map((word) => word.unitId))].map((unitId) => {
      const words = catalog.filter((word) => word.unitId === unitId);
      return { unitId, title: words[0].lessonTitle, wordCount: words.length, wordCountsByDifficulty: counts(words, settings.difficulties) };
    });
    const key = classKey(profile);
    const rankingSnap = key ? await ref(scope, 'weplay_periods', period.id).collection('entries').where('classKey', '==', key).get() : null;
    const entries = (rankingSnap?.docs || []).map((doc) => doc.data());
    const rankingByDifficulty = Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, entries.filter((entry) => entry.difficulty === difficulty).sort(compareEntries).slice(0, 50).map((entry, index) => ({ rank: index + 1, studentLabel: entry.studentLabel, score: entry.score, correctCount: entry.correctCount, isMe: entry.uid === uid }))]));
    return { policy, gameEnabled: settings.enabled, difficulties: settings.difficulties, challengeDifficulties, wordCountsByDifficulty: counts(catalog, settings.difficulties), challengeWordCountsByDifficulty: counts(catalog, challengeDifficulties), balance: Number(walletSnap.data()?.balance || 0), dailyUsed, dailyRemaining: Math.max(0, policy.dailyChallengeLimit - dailyUsed), lessons, wordCount: uniqueWordCount(catalog), activeSession: active ? publicSession(active) : null, records: recordsSnap.docs.map((doc) => doc.data()), period: publicPeriod(period), rankingByDifficulty, serverNowMs: Date.now() };
  });

  const startWeplayGame = onCall({ region: REGION }, async (request) => {
    const { uid, profile } = await student(request);
    const scope = scopeFrom(request.data);
    await assertCurrentScope(scope);
    const mode = request.data?.mode;
    if (!['practice', 'challenge'].includes(mode)) invalid('게임 모드를 확인해 주세요.');
    const difficulty = request.data?.difficulty;
    if (!DIFFICULTIES.includes(difficulty)) invalid('게임 난이도를 선택해 주세요.');
    const requestKey = identifier(request.data?.requestKey, '요청 번호');
    const sessionId = hash(`${scope.year}:${scope.semester}:${uid}:${requestKey}`);
    const existing = await ref(scope, 'weplay_sessions', sessionId).get();
    if (existing.exists) return publicSession(existing.data());
    await recoverActive(scope, uid);
    const { settings: catalogSettings, catalog: allWords } = await readCatalog(scope);
    if (!catalogSettings.enabled) throw new HttpsError('failed-precondition', '현재 학생 게임 이용을 허용하지 않습니다.');
    const period = mode === 'challenge' ? await ensurePeriod(scope) : null;
    const difficultySettings = (mode === 'challenge' ? readDifficulties(period.difficulties) : catalogSettings.difficulties)[difficulty];
    const unitIds = request.data?.unitIds;
    if (unitIds !== undefined && (!Array.isArray(unitIds) || unitIds.length > 200 || unitIds.some((id) => typeof id !== 'string' || id.length > 128))) invalid('출제 범위를 확인해 주세요.');
    const catalog = mode === 'practice' && unitIds?.length ? allWords.filter((word) => unitIds.includes(word.unitId)) : allWords;
    const key = classKey(profile);
    if (mode === 'challenge' && !key) throw new HttpsError('failed-precondition', '학년과 반을 등록한 뒤 도전해 주세요.');
    let words;
    try { words = buildWords(catalog, mode === 'challenge' ? `${scope.year}:${scope.semester}:${period.id}:${key}:${difficulty}` : sessionId, difficulty, difficultySettings, catalogSettings); }
    catch (error) { throw new HttpsError('failed-precondition', error.message); }
    const output = await db.runTransaction(async (transaction) => {
      const sessionRef = ref(scope, 'weplay_sessions', sessionId);
      const repeated = await transaction.get(sessionRef);
      if (repeated.exists) return { session: repeated.data(), charged: false };
      const gameSettings = settingsFromSnap(await transaction.get(ref(scope, 'weplay_games', GAME_ID)));
      if (!gameSettings.enabled) throw new HttpsError('failed-precondition', '현재 학생 게임 이용을 허용하지 않습니다.');
      if (JSON.stringify(gameSettings) !== JSON.stringify(catalogSettings)) {
        throw new HttpsError('aborted', '출제 자료 설정이 변경되었습니다. 다시 시작해 주세요.');
      }
      const currentProfile = (await transaction.get(db.doc(`users/${uid}`))).data();
      if (!currentProfile || currentProfile.role !== 'student' || currentProfile.weplayDeletionPending === true || currentProfile.deletedAt || currentProfile.isDeleted === true) {
        throw new HttpsError('permission-denied', '학생 계정 상태를 확인해 주세요.');
      }
      const policy = policyFromSnap(await transaction.get(ref(scope, 'weplay_policies', 'current')));
      const playerRef = ref(scope, 'weplay_players', uid);
      const player = (await transaction.get(playerRef)).data() || {};
      if (player.activeSessionId) {
        const active = (await transaction.get(ref(scope, 'weplay_sessions', player.activeSessionId))).data();
        if (active?.status === 'active') throw new HttpsError('already-exists', '진행 중인 게임을 먼저 마쳐 주세요.');
      }
      const loaded = mode === 'challenge' && policy.challengeCost > 0
        ? await loadWallet(transaction, scope, uid, profile)
        : { wallet: (await transaction.get(ref(scope, 'point_wallets', uid))).data() || {} };
      const costSnap = await transaction.get(ref(scope, 'point_transactions', `weplay_cost_${sessionId}`));
      if (costSnap.exists) throw new HttpsError('failed-precondition', '도전 비용 기록을 확인해 주세요.');
      const currentPeriod = period ? (await transaction.get(ref(scope, 'weplay_periods', period.id))).data() : null;
      const now = Date.now();
      const today = dayKey(now);
      const used = player.dateKey === today ? Number(player.challengeUsed || 0) : 0;
      if (mode === 'challenge') {
        if (!policy.enabled) throw new HttpsError('failed-precondition', '현재 위스 도전을 운영하지 않습니다.');
        if (used >= policy.dailyChallengeLimit) throw new HttpsError('resource-exhausted', '오늘의 도전 횟수를 모두 사용했습니다.');
        if (!currentPeriod || currentPeriod.status !== 'open' || currentPeriod.endsAtMs <= now) throw new HttpsError('aborted', '랭킹 기간이 바뀌었습니다. 다시 시작해 주세요.');
        if (Number(loaded.wallet.balance || 0) < policy.challengeCost) throw new HttpsError('failed-precondition', '보유 위스가 부족합니다.');
      }
      const profileSnapshot = buildWalletBase(uid, profile);
      const session = {
        id: sessionId, uid, mode, difficulty, difficultySettings, status: 'active', startsAtMs: now + START_DELAY_MS, endsAtMs: now + START_DELAY_MS + difficultySettings.durationSeconds * 1000,
        words, acceptedWordIds: [], battleVersion: 1, acceptedEvents: [], answerEvents: {}, answerEventCount: 0, policy, gameSettingsVersion: gameSettings.version,
        profile: profileSnapshot, classKey: key, studentLabel: studentLabel(profile),
        periodId: period?.id || null, result: null, createdAt: FieldValue.serverTimestamp(),
      };
      if (mode === 'challenge' && policy.challengeCost > 0) await writePointChange(transaction, scope, uid, profile, -policy.challengeCost, 'weplay_cost', sessionId, '내가 충무공이라고?! 도전 비용', policy.version, loaded);
      transaction.create(sessionRef, session);
      transaction.set(playerRef, { activeSessionId: sessionId, dateKey: today, challengeUsed: used + (mode === 'challenge' ? 1 : 0) }, { merge: true });
      transaction.set(db.doc(`weplay_session_queue/${sessionId}`), { ...scope, sessionId, dueAtMs: session.endsAtMs + 5000 });
      return { session, charged: mode === 'challenge' && policy.challengeCost > 0 };
    });
    if (output.charged) await markWisHallOfFameDirtySafely(scope.year, scope.semester);
    return publicSession(output.session);
  });

  const submitWeplayAnswer = onCall({ region: REGION }, async (request) => {
    const receivedAtMs = Date.now();
    const { uid } = await student(request);
    const scope = scopeFrom(request.data);
    const sessionId = identifier(request.data?.sessionId, '게임 번호');
    const eventId = identifier(request.data?.eventId, '입력 번호');
    const wordId = identifier(request.data?.wordId, '단어 번호');
    const answer = request.data?.answer;
    if (typeof answer !== 'string' || answer.length > 80) invalid('입력한 단어를 확인해 주세요.');
    // Time is measured on receipt, never supplied by the client. Retries retain the
    // original event verdict and a transaction serializes simultaneous answers.
    return db.runTransaction(async (transaction) => {
      const sessionRef = ref(scope, 'weplay_sessions', sessionId);
      const session = (await transaction.get(sessionRef)).data();
      if (!session) throw new HttpsError('not-found', '게임 기록을 찾을 수 없습니다.');
      if (session.uid !== uid) throw new HttpsError('permission-denied', '본인의 게임만 입력할 수 있습니다.');
      const previous = Object.prototype.hasOwnProperty.call(session.answerEvents || {}, eventId) ? session.answerEvents[eventId] : null;
      const response = (verdict, value) => {
        const battle = value.battleVersion === 1 ? simulateWeplayBattle(value, Date.now() - value.startsAtMs) : null;
        return { ...verdict, correctCount: battle ? battle.normalCorrectCount : (value.acceptedWordIds || []).length, acceptedWordIds: value.acceptedWordIds || [], serverNowMs: Date.now(), ...(battle ? { acceptedEvents: value.acceptedEvents || [], battle } : {}) };
      };
      if (previous) return response(previous, session);
      if (Number(session.answerEventCount || 0) >= (session.battleVersion === 1 ? Math.min(400, session.words.length * 3) : 120)) throw new HttpsError('resource-exhausted', '입력 횟수를 초과했습니다.');
      // Serialize timestamps too: a late transaction must not insert a hit before
      // an already accepted hit and retroactively change defeat/combat outcomes.
      const effectiveAtMs = Math.max(receivedAtMs, session.startsAtMs + Math.max(0, ...(session.acceptedEvents || []).map((event) => event.elapsedMs)));
      const verdict = assessAnswer(session, wordId, answer, effectiveAtMs);
      const acceptedWordIds = verdict.accepted ? [...session.acceptedWordIds, wordId] : session.acceptedWordIds;
      const acceptedEvents = verdict.accepted && session.battleVersion === 1 ? [...(session.acceptedEvents || []), { wordId, elapsedMs: effectiveAtMs - session.startsAtMs }] : session.acceptedEvents || [];
      if (session.status === 'active') transaction.update(sessionRef, {
        acceptedWordIds, ...(session.battleVersion === 1 ? { acceptedEvents } : {}), [`answerEvents.${eventId}`]: verdict,
        answerEventCount: Number(session.answerEventCount || 0) + 1,
      });
      return response(verdict, { ...session, acceptedWordIds, acceptedEvents });
    });
  });

  const finishWeplayGame = onCall({ region: REGION }, async (request) => {
    const { uid } = await student(request);
    if (request.data?.exitEarly !== undefined && typeof request.data.exitEarly !== 'boolean') invalid('중도 종료 여부를 확인해 주세요.');
    return settleSession(scopeFrom(request.data), identifier(request.data?.sessionId, '게임 번호'), uid, request.data?.exitEarly === true);
  });

  async function settlePeriod(scope, periodId) {
    const periodRef = ref(scope, 'weplay_periods', periodId);
    const period = await db.runTransaction(async (transaction) => {
      const data = (await transaction.get(periodRef)).data();
      if (!data || data.status === 'closed' || data.endsAtMs + PERIOD_SETTLEMENT_DELAY_MS > Date.now()) return null;
      transaction.update(periodRef, { status: 'closing' });
      return data;
    });
    if (!period) return;
    // Every started game is settled before the final order is frozen, including
    // disconnects. After the grace period no answer/start can enter this period.
    const sessionSnap = await db.collection(path(scope, 'weplay_sessions')).where('periodId', '==', periodId).get();
    for (const sessionDoc of sessionSnap.docs) {
      if (sessionDoc.data().status !== 'finished') await settleSession(scope, sessionDoc.id);
    }
    const winners = await db.runTransaction(async (transaction) => {
      const current = (await transaction.get(periodRef)).data();
      if (Array.isArray(current.frozenWinners)) return current.frozenWinners;
      const entriesSnap = await transaction.get(periodRef.collection('entries'));
      const byClass = new Map();
      for (const entryDoc of entriesSnap.docs) {
        const entry = entryDoc.data();
        const groupKey = `${entry.classKey}:${entry.difficulty}`;
        if (!byClass.has(groupKey)) byClass.set(groupKey, []);
        byClass.get(groupKey).push(entry);
      }
      const frozenWinners = [...byClass.values()].flatMap((entries) => entries.sort(compareEntries).slice(0, 3).map((entry, index) => ({ uid: entry.uid, classKey: entry.classKey, difficulty: entry.difficulty, rank: index + 1 })));
      transaction.update(periodRef, { frozenWinners, frozenAt: FieldValue.serverTimestamp() });
      return frozenWinners;
    });
    let changed = false;
    for (const winner of winners) {
        if (!winner.uid) continue;
        const index = winner.rank - 1;
        const amount = period.rankingRewards[winner.difficulty][['first', 'second', 'third'][index]];
        const entryId = hash(`${winner.uid}:${winner.difficulty}`);
        const sourceId = hash(`${periodId}:${winner.uid}:${winner.difficulty}`);
        const didAward = await db.runTransaction(async (transaction) => {
          const currentPeriod = (await transaction.get(periodRef)).data();
          if (!currentPeriod.frozenWinners.some((entry) => entry.uid === winner.uid && entry.difficulty === winner.difficulty)) return false;
          const awardRef = periodRef.collection('awards').doc(entryId);
          if ((await transaction.get(awardRef)).exists) return false;
          const ledger = await transaction.get(ref(scope, 'point_transactions', `weplay_rank_reward_${sourceId}`));
          if (ledger.exists) throw new HttpsError('failed-precondition', '순위 보상 기록을 확인해 주세요.');
          const profileSnap = await transaction.get(db.doc(`users/${winner.uid}`));
          const profile = profileSnap.data();
          const eligible = !!profile && profile.role === 'student' && !profile.deletedAt && profile.isDeleted !== true && profile.weplayDeletionPending !== true;
          const loaded = eligible && amount > 0 ? await loadWallet(transaction, scope, winner.uid, profile) : null;
          const difficultyLabel = { mild: '착한맛', medium: '중간맛', spicy: '매운맛' }[winner.difficulty];
          if (loaded) await writePointChange(transaction, scope, winner.uid, profile, amount, 'weplay_rank_reward', sourceId, `${period.battleVersion === 1 ? '내가 충무공이라고?!' : '역사가 내려와'} ${difficultyLabel} 학급 ${index + 1}위`, period.policyVersion, loaded);
          transaction.create(awardRef, { uid: winner.uid, difficulty: winner.difficulty, rank: index + 1, amount: eligible ? amount : 0, skipped: !eligible, classKey: winner.classKey, awardedAt: FieldValue.serverTimestamp() });
          if (eligible) transaction.set(periodRef.collection('entries').doc(entryId), { finalRank: index + 1, rankReward: amount }, { merge: true });
          return eligible && amount > 0;
        });
        changed = changed || didAward;
    }
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(periodRef);
      if (snapshot.data()?.status !== 'closed') transaction.update(periodRef, { status: 'closed', finalizedAt: FieldValue.serverTimestamp() });
      transaction.delete(db.doc(`weplay_period_queue/${hash(`${scope.year}:${scope.semester}:${periodId}`)}`));
    });
    if (changed) await markWisHallOfFameDirtySafely(scope.year, scope.semester);
  }

  const settleWeplayOnSchedule = onSchedule({ schedule: 'every 5 minutes', region: REGION, timeZone: 'Asia/Seoul', timeoutSeconds: 540, memory: '512MiB' }, async () => {
    const dueSessions = await db.collection('weplay_session_queue').where('dueAtMs', '<=', Date.now()).limit(200).get();
    for (const doc of dueSessions.docs) {
      const data = doc.data();
      try { await settleSession({ year: data.year, semester: data.semester }, data.sessionId); }
      catch (error) {
        if (error.code === 'not-found') await doc.ref.delete();
        else console.error('Weplay session settlement failed', { sessionId: data.sessionId, code: error.code, message: error.message });
      }
    }
    const duePeriods = await db.collection('weplay_period_queue').where('dueAtMs', '<=', Date.now()).limit(20).get();
    for (const doc of duePeriods.docs) {
      const data = doc.data();
      try { await settlePeriod({ year: data.year, semester: data.semester }, data.periodId); }
      catch (error) { console.error('Weplay ranking settlement failed', { periodId: data.periodId, code: error.code, message: error.message }); }
    }
  });

  return { completeWeplayGuide, getWeplayManagement, saveWeplayGameSettings, previewWeplayGame, getWeplayPolicy, saveWeplayPolicy, getWeplayLobby, startWeplayGame, submitWeplayAnswer, finishWeplayGame, settleWeplayOnSchedule };
}

module.exports = { createWeplayFunctions };
