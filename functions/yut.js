const { createHash, randomInt } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');

const ADMIN_EMAIL = 'westoria28@gmail.com';
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const hash = (text) => createHash('sha256').update(text).digest('hex');
const text = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const fail = (code, message) => { throw new HttpsError(code, message); };
const identifier = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const isOpen = (room, now) => room && ['waiting', 'playing'].includes(room.status) && room.expiresAtMs > now;
const matchesMembership = (room, actor) => actor.manager || room.enrollmentIds?.[actor.uid] === actor.enrollmentId;
const koreaDay = (atMs) => new Date(atMs + 9 * 3600000).toISOString().slice(0, 10);
const privateUsed = (player, day) => player.privatePlayDay === day
  ? Number.isSafeInteger(player.privatePlayCount) && player.privatePlayCount >= 0 ? Math.min(5, player.privatePlayCount) : 5 : 0;
const modeAllowed = (actor, room) => actor.manager || (actor.settings.allowMultiplayer && (room.visibility === 'public' || actor.settings.allowPrivateRooms));
const publicRoom = (room) => {
  if (!room) return null;
  // Internal enrollment IDs are for rules checks; commands expose only game state.
  const { enrollmentIds, enrollmentSlotIds, ...result } = room;
  return result;
};

function createYutHandlers({ db, assertSession = assertScoreWorkflowSession, now = Date.now, random = randomInt }) {
  const rewards = require('./yutReward').createYutReward({ db });
  const scopeFrom = (data) => {
    if (typeof data?.year !== 'string' || !/^\d{4}$/.test(data.year) || !['1', '2'].includes(data.semester)) fail('invalid-argument', '현재 학기 정보를 확인해 주세요.');
    return { year: data.year, semester: data.semester, id: `${data.year}-${data.semester}` };
  };
  const ref = (scope, collection, id) => db.doc(`years/${scope.year}/semesters/${scope.semester}/${collection}/${id}`);
  const settingsFrom = (data) => {
    const valid = !!data && typeof data.enabled === 'boolean' && Number.isSafeInteger(data.version) && data.version >= 0;
    return { enabled: valid && data.enabled === true, version: valid ? data.version : 0,
      allowSolo: data?.allowSolo === undefined || data.allowSolo === true,
      allowMultiplayer: data?.allowMultiplayer === undefined || data.allowMultiplayer === true,
      allowPrivateRooms: data?.allowPrivateRooms === undefined || data.allowPrivateRooms === true,
      defaultPlayerCount: [2, 3, 4].includes(data?.defaultPlayerCount) ? data.defaultPlayerCount : 4,
      throwSeconds: Number.isInteger(data?.throwSeconds) && data.throwSeconds >= 3 && data.throwSeconds <= 15 ? data.throwSeconds : 5,
      moveSeconds: Number.isInteger(data?.moveSeconds) && data.moveSeconds >= 15 && data.moveSeconds <= 60 ? data.moveSeconds : 25,
      ...(Number.isFinite(data?.updatedAtMs) && data.updatedAtMs >= 0 ? { updatedAtMs: data.updatedAtMs } : {}) };
  };
  const readClass = async (reader, scope, classId) => {
    if (!identifier(classId)) fail('permission-denied', '현재 학급 정보를 확인해 주세요.');
    const classroom = (await reader.get(db.doc(`semester_classes/${classId}`))).data();
    if (!classroom || classroom.semesterId !== scope.id || classroom.status !== 'ACTIVE' || classroom.readOnly === true) fail('permission-denied', '현재 학급 정보를 확인해 주세요.');
    return classroom;
  };
  const authority = async (reader, request, scope) => {
    const uid = request.auth?.uid, email = text(request.auth?.token?.email, 320).toLowerCase();
    if (!uid) fail('unauthenticated', '로그인 후 이용해 주세요.');
    if (!/@yongshin-ms\.ms\.kr$/.test(email) && email !== ADMIN_EMAIL) fail('permission-denied', '위스토리 계정으로 이용해 주세요.');
    const [profileSnap, configSnap, pointerSnap, manifestSnap] = await Promise.all([
      reader.get(db.doc(`users/${uid}`)), reader.get(db.doc('site_settings/config')),
      reader.get(db.doc('site_settings/semester_active')), reader.get(db.doc(`semester_manifests/${scope.id}`)),
    ]);
    const profile = profileSnap.data() || {}, config = configSnap.data() || {}, pointer = pointerSnap.data() || {}, manifest = manifestSnap.data() || {};
    if (profile.isDeleted || profile.deletedAt || profile.weplayDeletionPending || (Object.hasOwn(profile, 'registrationApprovalStatus') && profile.registrationApprovalStatus !== 'APPROVED')) fail('permission-denied', '이 계정으로 게임에 참가할 수 없습니다.');
    if (String(config.year) !== scope.year || String(config.semester) !== scope.semester || pointer.semesterId !== scope.id
      || manifest.status !== 'ACTIVE' || manifest.readOnly === true || !Number.isSafeInteger(manifest.revision) || manifest.revision < 1 || pointer.revision !== manifest.revision) fail('failed-precondition', '현재 운영 중인 학기에서 이용해 주세요.');
    const canWrite = email === ADMIN_EMAIL || profile.role === 'teacher';
    const manager = canWrite
      || (profile.role === 'staff' && profile.teacherPortalEnabled === true && Array.isArray(profile.staffPermissions) && profile.staffPermissions.includes('lesson_read'));
    const settings = settingsFrom((await reader.get(ref(scope, 'weplay_games', 'joseon-yut'))).data());
    if (manager) return { uid, manager, canWrite, settings, name: '선생님', classId: '', enrollmentId: '', slotId: '' };
    if (profile.role !== 'student') fail('permission-denied', '게임을 이용할 권한이 없습니다.');
    if (!settings.enabled) fail('permission-denied', '지금은 윷놀이가 열려 있지 않습니다.');
    const slotId = `slot_${hash(`${scope.id}\n${uid}`).slice(0, 40)}`;
    const slot = (await reader.get(db.doc(`semester_enrollment_slots/${slotId}`))).data() || {};
    if (slot.studentUid !== uid || slot.semesterId !== scope.id || !identifier(slot.activeEnrollmentId) || (slot.status !== undefined && slot.status !== 'ACTIVE')) fail('permission-denied', '현재 학기의 수강 정보를 확인해 주세요.');
    const enrollment = (await reader.get(db.doc(`semester_enrollments/${slot.activeEnrollmentId}`))).data() || {};
    if (enrollment.studentUid !== uid || enrollment.semesterId !== scope.id || enrollment.enrollmentStatus !== 'ACTIVE' || enrollment.readOnly === true || !identifier(enrollment.classId)) fail('permission-denied', '현재 학기의 수강 정보를 확인해 주세요.');
    const classroom = await readClass(reader, scope, enrollment.classId);
    const rawName = text(profile.name || profile.studentName, 20), number = text(enrollment.studentNumber || profile.studentNumber || profile.number, 3).replace(/[^0-9]/g, '');
    return { uid, manager: false, settings, classId: enrollment.classId, enrollmentId: slot.activeEnrollmentId, slotId, classroom,
      name: `${number ? `${number}번 ` : ''}${rawName ? `${rawName[0]}${'○'.repeat(Math.min(3, Math.max(1, rawName.length - 1)))}` : '학생'}` };
  };
  const checkRoomAccess = (actor, room) => {
    if (!room || room.expiresAtMs <= now()) fail('not-found', '방을 찾을 수 없거나 이용 시간이 지났습니다.');
    if (room.participantUids.includes(actor.uid) && !matchesMembership(room, actor)) fail('permission-denied', '수강 정보가 변경되었습니다. 새 방에 참가해 주세요.');
  };
  const getYutLobby = async (request) => {
    await assertSession(request);
    const scope = scopeFrom(request.data);
    return db.runTransaction(async (transaction) => {
      const actor = await authority(transaction, request, scope);
      const pointer = (await transaction.get(ref(scope, 'yut_players', actor.uid))).data() || {};
      let room = null;
      if (identifier(pointer.roomId)) {
        const stored = (await transaction.get(ref(scope, 'yut_rooms', pointer.roomId))).data();
        if (stored?.participantUids?.includes(actor.uid) && stored.status !== 'closed' && stored.expiresAtMs > now()
          && matchesMembership(stored, actor) && modeAllowed(actor, stored)) room = publicRoom(stored);
      }
      // Cached teacher clients require a nonempty selection before creating a
      // room. This virtual option exposes no actual class directory and is
      // ignored by create; current clients no longer show a class selector.
      return { room, enabled: actor.settings.enabled, settings: actor.settings,
        privatePlaysRemaining: actor.manager ? null : 5 - privateUsed(pointer, koreaDay(now())),
        classes: actor.manager ? [{ id: 'school', label: '전체 학생' }] : [],
        classId: actor.manager ? 'school' : '', serverNowMs: now() };
    });
  };
  const getYutManagement = async (request) => {
    await assertSession(request);
    const scope = scopeFrom(request.data);
    return db.runTransaction(async (transaction) => {
      const actor = await authority(transaction, request, scope);
      if (!actor.manager) fail('permission-denied', '게임 관리 권한이 필요합니다.');
      const serverNowMs = now();
      // Filter active status in the query, so newer completed rooms cannot hide
      // an older live room. The dedicated composite index bounds this at 101.
      const snapshot = await transaction.get(db.collection(`years/${scope.year}/semesters/${scope.semester}/yut_rooms`)
        .where('status', 'in', ['waiting', 'playing'])
        .where('expiresAtMs', '>', serverNowMs).orderBy('expiresAtMs', 'desc').limit(101));
      const active = snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }));
      const cache = new Map();
      const read = (path) => {
        if (!cache.has(path)) cache.set(path, transaction.get(db.doc(path)).then((entry) => entry.data() || {}));
        return cache.get(path);
      };
      const rooms = await Promise.all(active.slice(0, 100).map(async (room) => ({
        id: room.id, code: room.code, status: room.status, revision: room.revision, hostUid: room.hostUid,
        createdAtMs: room.createdAtMs, expiresAtMs: room.expiresAtMs, turnUid: room.turnUid,
        visibility: room.visibility || 'private', maxPlayers: room.maxPlayers || 4 - (room.blockedSeats || []).length,
        pieceCount: room.pieceCount || room.players[0]?.pieces.length || 1,
        throwSeconds: room.throwSeconds || 5, moveSeconds: room.moveSeconds || 25,
        phaseStartsAtMs: room.phaseStartsAtMs || 0, turnDeadlineMs: room.turnDeadlineMs, phase: room.phase,
        players: await Promise.all(room.players.map(async (player) => {
          const result = { uid: player.uid, name: player.name, role: player.role, classLabel: '', studentNumber: '', active: player.active };
          const profile = await read(`users/${player.uid}`);
          if (profile.isDeleted || profile.deletedAt || profile.weplayDeletionPending) return { ...result, name: '탈퇴한 참가자' };
          if (profile.role === 'teacher' || profile.role === 'staff') return { ...result, name: text(profile.name || '선생님', 40) };
          const enrollmentId = room.enrollmentIds?.[player.uid], slotId = room.enrollmentSlotIds?.[player.uid];
          if (profile.role !== 'student' || !identifier(enrollmentId) || !identifier(slotId)) return result;
          const [enrollment, slot] = await Promise.all([read(`semester_enrollments/${enrollmentId}`), read(`semester_enrollment_slots/${slotId}`)]);
          if (enrollment.studentUid !== player.uid || enrollment.semesterId !== scope.id || enrollment.enrollmentStatus !== 'ACTIVE'
            || enrollment.readOnly === true || !identifier(enrollment.classId) || slot.studentUid !== player.uid
            || slot.semesterId !== scope.id || slot.activeEnrollmentId !== enrollmentId || (slot.status !== undefined && slot.status !== 'ACTIVE')) return result;
          const classroom = await read(`semester_classes/${enrollment.classId}`);
          if (classroom.semesterId !== scope.id || classroom.status !== 'ACTIVE' || classroom.readOnly === true) return result;
          return { ...result, name: text(enrollment.studentName || profile.name || profile.studentName || player.name, 40),
            studentNumber: text(enrollment.studentNumber, 10),
            classLabel: text(classroom.displayName || `${classroom.grade || ''}학년 ${classroom.classNumber || ''}반`, 60) };
        })),
      })));
      return { settings: actor.settings, rooms, truncated: active.length > 100, serverNowMs };
    });
  };
  const saveYutSettings = async (request) => {
    await assertSession(request);
    const scope = scopeFrom(request.data), data = request.data;
    if (typeof data.enabled !== 'boolean' || !Number.isSafeInteger(data.expectedVersion) || data.expectedVersion < 0
      || Object.keys(data).some((field) => !['year', 'semester', '_session', 'enabled', 'expectedVersion', 'allowSolo', 'allowMultiplayer', 'allowPrivateRooms', 'defaultPlayerCount', 'throwSeconds', 'moveSeconds'].includes(field))
      || ['allowSolo', 'allowMultiplayer', 'allowPrivateRooms'].some((field) => data[field] !== undefined && typeof data[field] !== 'boolean')
      || (data.defaultPlayerCount !== undefined && ![2, 3, 4].includes(data.defaultPlayerCount))
      || (data.throwSeconds !== undefined && (!Number.isInteger(data.throwSeconds) || data.throwSeconds < 3 || data.throwSeconds > 15))
      || (data.moveSeconds !== undefined && (!Number.isInteger(data.moveSeconds) || data.moveSeconds < 15 || data.moveSeconds > 60))) fail('invalid-argument', '게임 공개 설정을 확인해 주세요.');
    return db.runTransaction(async (transaction) => {
      const actor = await authority(transaction, request, scope);
      if (!actor.canWrite) fail('permission-denied', '교사만 게임 공개 설정을 바꿀 수 있습니다.');
      if (data.expectedVersion !== actor.settings.version) fail('aborted', '다른 곳에서 공개 설정을 바꿨습니다. 새로 불러온 뒤 다시 저장해 주세요.');
      if (actor.settings.version >= Number.MAX_SAFE_INTEGER) fail('failed-precondition', '공개 설정 버전을 확인해 주세요.');
      const serverNowMs = now(), settings = { ...actor.settings, enabled: data.enabled, version: actor.settings.version + 1, updatedAtMs: serverNowMs };
      for (const field of ['allowSolo', 'allowMultiplayer', 'allowPrivateRooms', 'defaultPlayerCount', 'throwSeconds', 'moveSeconds']) if (data[field] !== undefined) settings[field] = data[field];
      transaction.set(ref(scope, 'weplay_games', 'joseon-yut'), { ...settings, updatedBy: actor.uid });
      return { settings, serverNowMs };
    });
  };
  const commandYutRoom = async (request) => {
    await assertSession(request);
    const scope = scopeFrom(request.data), data = request.data, action = data.action;
    if (!['create', 'join', 'match', 'ready', 'start', 'throw', 'move', 'skip', 'leave', 'close', 'emote', 'seat', 'claimReward'].includes(action)
      || typeof data.requestKey !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(data.requestKey)) fail('invalid-argument', '게임 요청을 다시 확인해 주세요.');
    if (!['create', 'join', 'match'].includes(action) && !identifier(data.roomId)) fail('invalid-argument', '방 정보를 새로 불러와 주세요.');
    if (!['create', 'join', 'match', 'emote'].includes(action) && (!Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0)) fail('invalid-argument', '방 정보를 새로 불러와 주세요.');
    if (['create', 'match'].includes(action) && data.maxPlayers !== undefined && ![2, 3, 4].includes(data.maxPlayers)) fail('invalid-argument', '참가 인원은 2~4명으로 정해 주세요.');
    if (action === 'create' && data.visibility !== undefined && !['public', 'private'].includes(data.visibility)) fail('invalid-argument', '공개 방 또는 비밀 방을 선택해 주세요.');
    const core = await import('./yutCore.mjs');
    if (action === 'emote' && (!core.YUT_EMOTE_KINDS.includes(data.kind)
      || Object.keys(data).some((field) => !['year', 'semester', '_session', 'action', 'requestKey', 'roomId', 'kind', 'expectedRevision'].includes(field)))) fail('invalid-argument', '정해진 감정표현만 보낼 수 있습니다.');
    const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
    if (action === 'join' && !/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(code)) fail('invalid-argument', '참가 코드 6자리를 입력해 주세요.');
    if (action === 'ready' && typeof data.ready !== 'boolean') fail('invalid-argument', '준비 상태를 확인해 주세요.');
    if (action === 'seat' && (!Number.isInteger(data.seat) || data.seat < 0 || data.seat > 3 || typeof data.blocked !== 'boolean')) fail('invalid-argument', '변경할 자리를 확인해 주세요.');
    if (action === 'throw' && data.power !== undefined && (!Number.isFinite(data.power) || data.power < 0 || data.power > 1)) fail('invalid-argument', '던지는 세기를 확인해 주세요.');
    if (action === 'move' && (!['1', '2'].includes(data.pieceId) || !['outer', 'a', 'b'].includes(data.route) || (data.stack !== undefined && typeof data.stack !== 'boolean'))) fail('invalid-argument', '이동할 말과 길을 선택해 주세요.');
    if (action === 'claimReward' && Object.keys(data).some((field) => !['year', 'semester', '_session', 'action', 'requestKey', 'roomId', 'expectedRevision'].includes(field))) fail('invalid-argument', '우승 보상 요청을 확인해 주세요.');
    // Preserve existing command fingerprints across deployment, including a
    // retry whose first response was lost before this version was deployed.
    const fingerprintFields = [action, data.roomId || '', action === 'emote' ? null : data.expectedRevision ?? null, code, data.classId || '', data.ready ?? null, data.pieceId || '', data.route || ''];
    if (action === 'emote') fingerprintFields.push(data.kind);
    if (action === 'seat') fingerprintFields.push(data.seat, data.blocked);
    if (action === 'throw' && data.power !== undefined) fingerprintFields.push('power', data.power);
    if (action === 'move' && data.stack !== undefined) fingerprintFields.push('stack', data.stack);
    if (['create', 'match'].includes(action) && (data.visibility !== undefined || data.maxPlayers !== undefined)) fingerprintFields.push(data.visibility ?? null, data.maxPlayers ?? null);
    const fingerprint = hash(JSON.stringify(fingerprintFields));
    const generatedCode = Array.from({ length: 6 }, () => alphabet[random(alphabet.length)]).join('');
    // Draw once before transaction retries; a transaction retry cannot reroll.
    const sticks = action === 'throw' ? Array.from({ length: 4 }, () => random(2) === 1) : null;
    const weightedSticks = action === 'throw' ? core.sampleYutSticks(data.power, () => random(0x100000000) / 0x100000000) : null;
    return db.runTransaction(async (transaction) => {
      const actor = await authority(transaction, request, scope), receivedAt = now();
      if (!actor.manager && !actor.settings.allowMultiplayer && !['leave', 'close'].includes(action)) fail('permission-denied', '지금은 함께하기가 열려 있지 않습니다.');
      const playerRef = ref(scope, 'yut_players', actor.uid), player = (await transaction.get(playerRef)).data() || {};
      const quotaUpdates = new Map();
      const history = Array.isArray(player.commands) ? player.commands : [];
      const previous = history.find((entry) => entry.key === data.requestKey);
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail('already-exists', '같은 요청 번호로 다른 동작을 보낼 수 없습니다.');
        const old = previous.roomId ? (await transaction.get(ref(scope, 'yut_rooms', previous.roomId))).data() : null;
        if (old && !modeAllowed(actor, old)) fail('permission-denied', '지금은 이 게임 모드가 열려 있지 않습니다.');
        return { room: old?.participantUids?.includes(actor.uid) && old.expiresAtMs > receivedAt && matchesMembership(old, actor) ? publicRoom(old) : null, serverNowMs: receivedAt };
      }
      if (action !== 'emote' && Number(player.lastCommandAtMs || 0) + 250 > receivedAt) fail('resource-exhausted', '잠시 후 다시 눌러 주세요.');
      let room, roomId, codeRef = null, transferredRoom = null, matchQueue = null;
      if (['create', 'join', 'match'].includes(action)) {
        if (identifier(player.roomId)) {
          const current = (await transaction.get(ref(scope, 'yut_rooms', player.roomId))).data();
          if (isOpen(current, receivedAt) && current.participantUids.includes(actor.uid)) {
            if (!matchesMembership(current, actor) || !modeAllowed(actor, current)) transferredRoom = core.leaveYutRoom(current, actor.uid, receivedAt);
            else if ((action === 'join' && current.code === code) || (action === 'match' && current.visibility === 'public')) {
              if (!actor.manager && current.visibility !== 'public' && current.status === 'waiting' && privateUsed(player, koreaDay(receivedAt)) >= 5) fail('resource-exhausted', '오늘의 비밀 방 5판을 모두 이용했습니다.');
              // Record even a no-op reconnect: a delayed retry after leaving
              // must not silently join or create a room again.
              transaction.set(playerRef, { ...player, lastCommandAtMs: receivedAt,
                commands: [...history, { key: data.requestKey, fingerprint, roomId: current.id }].slice(-32) });
              return { room: publicRoom(current), serverNowMs: receivedAt };
            } else fail('failed-precondition', '참가 중인 방에서 먼저 나와 주세요.');
          }
        }
        if (action === 'match') {
          // Serialize an empty-queue match as well as a join, so simultaneous
          // requests do not each create a separate empty public room.
          const queueRef = ref(scope, 'yut_matchmaking', 'queue');
          const queue = (await transaction.get(queueRef)).data() || {};
          matchQueue = { ref: queueRef, revision: Number(queue.revision || 0) + 1 };
          // Status/privacy are queried before limiting: private or finished rooms
          // can never consume the public matchmaking candidate window.
          const candidates = await transaction.get(db.collection(`years/${scope.year}/semesters/${scope.semester}/yut_rooms`)
            .where('visibility', '==', 'public').where('status', '==', 'waiting').where('joinable', '==', true)
            .where('expiresAtMs', '>', receivedAt).orderBy('expiresAtMs', 'desc').limit(40));
          const available = candidates.docs.map((entry) => ({ ...entry.data(), id: entry.id }))
            .filter((entry) => entry.players.length < 4 - (entry.blockedSeats || []).length && !entry.participantUids.includes(actor.uid));
          if (available.length) {
            room = available[random(available.length)]; roomId = room.id;
            room = core.addYutPlayer(room, { uid: actor.uid, name: actor.name }, receivedAt);
          }
        }
        if (action === 'create' || (action === 'match' && !room)) {
          const visibility = action === 'match' ? 'public' : data.visibility || 'private';
          if (!actor.manager && visibility === 'private' && (!actor.settings.allowPrivateRooms || privateUsed(player, koreaDay(receivedAt)) >= 5)) fail('permission-denied', '비밀 방은 하루 5판까지 이용할 수 있으며 교사가 허용해야 합니다.');
          const day = koreaDay(receivedAt);
          if (player.createDay === day && Number(player.createCount || 0) >= 40) fail('resource-exhausted', '오늘 만들 수 있는 방 수를 초과했습니다.');
          roomId = hash(`${scope.id}\n${actor.uid}\n${data.requestKey}`).slice(0, 40);
          const existing = (await transaction.get(ref(scope, 'yut_rooms', roomId))).data();
          if (existing) fail('already-exists', '처리된 방 만들기 요청입니다. 대기실을 새로 불러와 주세요.');
          codeRef = ref(scope, 'yut_codes', generatedCode);
          const existingCode = (await transaction.get(codeRef)).data();
          if (existingCode && existingCode.expiresAtMs > receivedAt) fail('unavailable', '참가 코드를 다시 만들고 있습니다. 한 번 더 눌러 주세요.');
          room = core.createYutRoom({ id: roomId, code: generatedCode, classId: '', classLabel: '함께하는 윷판', host: { uid: actor.uid, name: actor.name }, nowMs: receivedAt,
            visibility, maxPlayers: data.maxPlayers ?? actor.settings.defaultPlayerCount, throwSeconds: actor.settings.throwSeconds, moveSeconds: actor.settings.moveSeconds });
          room.enrollmentIds = { [actor.uid]: actor.enrollmentId };
          room.enrollmentSlotIds = { [actor.uid]: actor.slotId };
          player.createCount = player.createDay === day ? Number(player.createCount || 0) + 1 : 1;
          player.createDay = day;
        } else if (action === 'join') {
          const codeData = (await transaction.get(ref(scope, 'yut_codes', code))).data();
          if (!codeData || codeData.expiresAtMs <= receivedAt || !identifier(codeData.roomId)) fail('not-found', '참가 코드를 확인해 주세요.');
          roomId = codeData.roomId;
          room = (await transaction.get(ref(scope, 'yut_rooms', roomId))).data();
          checkRoomAccess(actor, room);
          if (!modeAllowed(actor, room)) fail('permission-denied', '지금은 비밀 방이 열려 있지 않습니다.');
          if (!actor.manager && room.visibility !== 'public' && privateUsed(player, koreaDay(receivedAt)) >= 5) fail('resource-exhausted', '오늘의 비밀 방 5판을 모두 이용했습니다.');
          try { room = core.addYutPlayer(room, { uid: actor.uid, name: actor.name }, receivedAt); }
          catch (error) { fail('failed-precondition', error.message); }
        }
        room.enrollmentIds = { ...(room.enrollmentIds || {}), [actor.uid]: actor.enrollmentId };
        room.enrollmentSlotIds = { ...(room.enrollmentSlotIds || {}), [actor.uid]: actor.slotId };
      } else {
        roomId = data.roomId;
        room = (await transaction.get(ref(scope, 'yut_rooms', roomId))).data();
        checkRoomAccess(actor, room);
        if (!['leave', 'close'].includes(action) && !modeAllowed(actor, room)) fail('permission-denied', '지금은 이 게임 모드가 열려 있지 않습니다.');
        const participant = room.participantUids.includes(actor.uid);
        if (!participant && !(action === 'close' && actor.canWrite)) fail('permission-denied', '참가 중인 방에서만 이용할 수 있습니다.');
        if (action !== 'emote' && room.revision !== data.expectedRevision) fail('aborted', '다른 참가자의 동작이 먼저 반영되었습니다. 최신 화면에서 다시 눌러 주세요.');
        if (action === 'emote' && Number(player.lastEmoteAtMs || 0) + core.YUT_EMOTE_COOLDOWN_MS > receivedAt) fail('resource-exhausted', '감정표현은 5초마다 보낼 수 있습니다.');
        if (['start', 'close'].includes(action) && room.hostUid !== actor.uid && !(action === 'close' && actor.canWrite)) fail('permission-denied', '방장만 시작하거나 방을 닫을 수 있습니다.');
        if (action === 'claimReward' && (actor.manager || room.status !== 'finished' || room.finishReason !== 'completion'
          || room.winnerUid !== actor.uid || room.reward?.status !== 'pending')) fail('failed-precondition', '완주한 우승자의 미지급 보상만 다시 받을 수 있습니다.');
        if (action === 'start') {
          room.winnerRewardPolicy = await rewards.snapshot(transaction, scope);
          // Every participant still needs an active enrollment in this semester,
          // but each may belong to a different class.
          for (const member of room.players) {
            const memberProfile = (await transaction.get(db.doc(`users/${member.uid}`))).data() || {};
            if (memberProfile.isDeleted || memberProfile.deletedAt || memberProfile.weplayDeletionPending
              || (Object.hasOwn(memberProfile, 'registrationApprovalStatus') && memberProfile.registrationApprovalStatus !== 'APPROVED')) fail('failed-precondition', '참가자 정보가 변경되었습니다. 대기실을 다시 만들어 주세요.');
            if (memberProfile.role !== 'student' && memberProfile.role !== 'teacher'
              && !(memberProfile.role === 'staff' && memberProfile.teacherPortalEnabled === true && Array.isArray(memberProfile.staffPermissions) && memberProfile.staffPermissions.includes('lesson_read'))
              && !(member.uid === actor.uid && actor.manager)) fail('failed-precondition', '참가자의 이용 권한이 변경되었습니다. 대기실을 다시 만들어 주세요.');
            if (memberProfile.role === 'student') {
              const enrollmentId = room.enrollmentIds?.[member.uid];
              if (!identifier(enrollmentId)) fail('failed-precondition', '참가자의 수강 정보를 확인해 주세요.');
              const enrollment = (await transaction.get(db.doc(`semester_enrollments/${enrollmentId}`))).data() || {};
              const slotId = room.enrollmentSlotIds?.[member.uid];
              if (!identifier(slotId)) fail('failed-precondition', '참가자의 수강 정보를 확인해 주세요.');
              const slot = (await transaction.get(db.doc(`semester_enrollment_slots/${slotId}`))).data() || {};
              if (enrollment.studentUid !== member.uid || enrollment.semesterId !== scope.id
                || enrollment.enrollmentStatus !== 'ACTIVE' || enrollment.readOnly === true || slot.studentUid !== member.uid
                || slot.semesterId !== scope.id || slot.activeEnrollmentId !== enrollmentId || (slot.status !== undefined && slot.status !== 'ACTIVE')) fail('failed-precondition', '참가자의 학급 정보가 변경되었습니다. 대기실을 다시 만들어 주세요.');
              await readClass(transaction, scope, enrollment.classId);
              if (room.visibility !== 'public' && !room.privatePlayChargedAtMs) {
                const memberRef = ref(scope, 'yut_players', member.uid);
                const memberPlayer = member.uid === actor.uid ? player : (await transaction.get(memberRef)).data() || {};
                const day = koreaDay(receivedAt), used = privateUsed(memberPlayer, day);
                if (used >= 5) fail('resource-exhausted', '참가자 중 오늘의 비밀 방 5판을 모두 이용한 학생이 있습니다.');
                quotaUpdates.set(member.uid, { privatePlayDay: day, privatePlayCount: used + 1 });
              }
            }
          }
        }
        try {
          if (action === 'ready') room = core.readyYutPlayer(room, actor.uid, data.ready, receivedAt);
          if (action === 'seat') room = core.setYutSeat(room, actor.uid, data.seat, data.blocked, receivedAt);
          if (action === 'start') room = core.startYutGame(room, receivedAt);
          if (action === 'start' && room.visibility !== 'public') room.privatePlayChargedAtMs = receivedAt;
          if (action === 'throw') room = core.throwYut(room, actor.uid, room.rulesVersion === 2 ? weightedSticks : sticks, receivedAt, data.power);
          if (action === 'move') room = core.moveYut(room, actor.uid, data.pieceId, data.route, receivedAt, data.stack);
          if (action === 'skip') room = core.skipYutTurn(room, receivedAt);
          if (action === 'leave') room = core.leaveYutRoom(room, actor.uid, receivedAt);
          if (action === 'close') room = core.closeYutRoom(room, receivedAt);
          if (action === 'emote') room = core.addYutEmote(room, actor.uid, data.kind, data.requestKey, receivedAt);
        } catch (error) { fail('failed-precondition', error.message); }
      }
      // Only the authoritative move that completes the board, or its winner's
      // pending settlement retry, can mint a reward. Forfeit/close never enter.
      if ((action === 'move' && room.status === 'finished') || action === 'claimReward') {
        const reward = await rewards.prepare(transaction, scope, room, actor, receivedAt);
        reward.apply();
        room.reward = reward.reward;
        if (action === 'claimReward') {
          room.syncRevision = (room.syncRevision ?? room.revision) + 1;
          room.revision += 1;
          room.updatedAtMs = receivedAt;
        }
      }
      const returnedRoomId = action === 'leave' || action === 'close' ? null : roomId;
      room.joinable = room.status === 'waiting' && room.players.length < 4 - (room.blockedSeats || []).length;
      if (transferredRoom) {
        transferredRoom.joinable = transferredRoom.status === 'waiting' && transferredRoom.players.length < 4 - (transferredRoom.blockedSeats || []).length;
        transaction.set(ref(scope, 'yut_rooms', transferredRoom.id), transferredRoom);
      }
      transaction.set(ref(scope, 'yut_rooms', roomId), room);
      if (codeRef) transaction.set(codeRef, { roomId, expiresAtMs: room.expiresAtMs });
      if (matchQueue) transaction.set(matchQueue.ref, { revision: matchQueue.revision, updatedAtMs: receivedAt });
      for (const [uid, quota] of quotaUpdates) {
        if (uid === actor.uid) Object.assign(player, quota);
        else transaction.set(ref(scope, 'yut_players', uid), quota, { merge: true });
      }
      const pointerRoomId = ['emote', 'claimReward'].includes(action) ? player.roomId || null
        : returnedRoomId || (player.roomId === roomId ? null : player.roomId || null);
      transaction.set(playerRef, { ...player, roomId: pointerRoomId,
        ...(action === 'emote' ? { lastEmoteAtMs: receivedAt } : { lastCommandAtMs: receivedAt }),
        commands: [...history, { key: data.requestKey, fingerprint, roomId: returnedRoomId }].slice(-32) });
      return { room: returnedRoomId ? publicRoom(room) : null, serverNowMs: receivedAt };
    });
  };
  return { getYutLobby, commandYutRoom, getYutManagement, saveYutSettings };
}

module.exports = { createYutHandlers };
