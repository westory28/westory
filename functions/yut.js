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
const matchesMembership = (room, actor) => actor.manager || (room.classId === actor.classId && room.enrollmentIds?.[actor.uid] === actor.enrollmentId);
const classLabel = (data) => text(data.displayName || `${data.grade}학년 ${data.classNumber}반`, 60);
const publicRoom = (room) => {
  if (!room) return null;
  // Internal enrollment IDs are for rules checks; commands expose only game state.
  const { enrollmentIds, enrollmentSlotIds, ...result } = room;
  return result;
};

function createYutHandlers({ db, assertSession = assertScoreWorkflowSession, now = Date.now, random = randomInt }) {
  const scopeFrom = (data) => {
    if (typeof data?.year !== 'string' || !/^\d{4}$/.test(data.year) || !['1', '2'].includes(data.semester)) fail('invalid-argument', '현재 학기 정보를 확인해 주세요.');
    return { year: data.year, semester: data.semester, id: `${data.year}-${data.semester}` };
  };
  const ref = (scope, collection, id) => db.doc(`years/${scope.year}/semesters/${scope.semester}/${collection}/${id}`);
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
    const manager = email === ADMIN_EMAIL || profile.role === 'teacher'
      || (profile.role === 'staff' && profile.teacherPortalEnabled === true && Array.isArray(profile.staffPermissions) && profile.staffPermissions.includes('lesson_read'));
    if (manager) return { uid, manager, name: '선생님', classId: '', enrollmentId: '', slotId: '' };
    if (profile.role !== 'student') fail('permission-denied', '게임을 이용할 권한이 없습니다.');
    const slotId = `slot_${hash(`${scope.id}\n${uid}`).slice(0, 40)}`;
    const slot = (await reader.get(db.doc(`semester_enrollment_slots/${slotId}`))).data() || {};
    if (slot.studentUid !== uid || slot.semesterId !== scope.id || !identifier(slot.activeEnrollmentId) || (slot.status !== undefined && slot.status !== 'ACTIVE')) fail('permission-denied', '현재 학기의 수강 정보를 확인해 주세요.');
    const enrollment = (await reader.get(db.doc(`semester_enrollments/${slot.activeEnrollmentId}`))).data() || {};
    if (enrollment.studentUid !== uid || enrollment.semesterId !== scope.id || enrollment.enrollmentStatus !== 'ACTIVE' || enrollment.readOnly === true || !identifier(enrollment.classId)) fail('permission-denied', '현재 학기의 수강 정보를 확인해 주세요.');
    const classroom = await readClass(reader, scope, enrollment.classId);
    const rawName = text(profile.name || profile.studentName, 20), number = text(enrollment.studentNumber || profile.studentNumber || profile.number, 3).replace(/[^0-9]/g, '');
    return { uid, manager: false, classId: enrollment.classId, enrollmentId: slot.activeEnrollmentId, slotId, classroom,
      name: `${number ? `${number}번 ` : ''}${rawName ? `${rawName[0]}${'○'.repeat(Math.min(3, Math.max(1, rawName.length - 1)))}` : '학생'}` };
  };
  const checkRoomClass = async (reader, scope, actor, room) => {
    if (!room || room.expiresAtMs <= now()) fail('not-found', '방을 찾을 수 없거나 이용 시간이 지났습니다.');
    if (!actor.manager && actor.classId !== room.classId) fail('permission-denied', '같은 학급의 방에만 참가할 수 있습니다.');
    if (room.participantUids.includes(actor.uid) && !matchesMembership(room, actor)) fail('permission-denied', '수강 정보가 변경되었습니다. 새 방에 참가해 주세요.');
    if (actor.manager) await readClass(reader, scope, room.classId);
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
          && matchesMembership(stored, actor)) room = publicRoom(stored);
      }
      const classes = actor.manager
        ? (await transaction.get(db.collection('semester_classes').where('semesterId', '==', scope.id))).docs
          .filter((entry) => entry.data().status === 'ACTIVE' && entry.data().readOnly !== true)
          .map((entry) => ({ id: entry.id, label: classLabel(entry.data()) }))
          .sort((a, b) => a.label.localeCompare(b.label, 'ko', { numeric: true }))
        : [{ id: actor.classId, label: classLabel(actor.classroom) }];
      return { room, classes, classId: actor.classId, serverNowMs: now() };
    });
  };
  const commandYutRoom = async (request) => {
    await assertSession(request);
    const scope = scopeFrom(request.data), data = request.data, action = data.action;
    if (!['create', 'join', 'ready', 'start', 'throw', 'move', 'skip', 'leave', 'close'].includes(action)
      || typeof data.requestKey !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(data.requestKey)) fail('invalid-argument', '게임 요청을 다시 확인해 주세요.');
    if (!['create', 'join'].includes(action) && (!identifier(data.roomId) || !Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0)) fail('invalid-argument', '방 정보를 새로 불러와 주세요.');
    const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
    if (action === 'join' && !/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(code)) fail('invalid-argument', '참가 코드 6자리를 입력해 주세요.');
    if (action === 'ready' && typeof data.ready !== 'boolean') fail('invalid-argument', '준비 상태를 확인해 주세요.');
    if (action === 'move' && (!['1', '2'].includes(data.pieceId) || !['outer', 'a', 'b'].includes(data.route))) fail('invalid-argument', '이동할 말과 길을 선택해 주세요.');
    const fingerprint = hash(JSON.stringify([action, data.roomId || '', data.expectedRevision ?? null, code, data.classId || '', data.ready ?? null, data.pieceId || '', data.route || '']));
    const generatedCode = Array.from({ length: 6 }, () => alphabet[random(alphabet.length)]).join('');
    // Draw once before transaction retries; a transaction retry cannot reroll.
    const sticks = action === 'throw' ? Array.from({ length: 4 }, () => random(2) === 1) : null;
    const core = await import('./yutCore.mjs');
    return db.runTransaction(async (transaction) => {
      const actor = await authority(transaction, request, scope), receivedAt = now();
      const playerRef = ref(scope, 'yut_players', actor.uid), player = (await transaction.get(playerRef)).data() || {};
      const history = Array.isArray(player.commands) ? player.commands : [];
      const previous = history.find((entry) => entry.key === data.requestKey);
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail('already-exists', '같은 요청 번호로 다른 동작을 보낼 수 없습니다.');
        const old = previous.roomId ? (await transaction.get(ref(scope, 'yut_rooms', previous.roomId))).data() : null;
        return { room: old?.participantUids?.includes(actor.uid) && old.expiresAtMs > receivedAt && matchesMembership(old, actor) ? publicRoom(old) : null, serverNowMs: receivedAt };
      }
      if (Number(player.lastCommandAtMs || 0) + 250 > receivedAt) fail('resource-exhausted', '잠시 후 다시 눌러 주세요.');
      let room, roomId, codeRef = null, transferredRoom = null;
      if (action === 'create' || action === 'join') {
        if (identifier(player.roomId)) {
          const current = (await transaction.get(ref(scope, 'yut_rooms', player.roomId))).data();
          if (isOpen(current, receivedAt) && current.participantUids.includes(actor.uid)) {
            if (!matchesMembership(current, actor)) transferredRoom = core.leaveYutRoom(current, actor.uid, receivedAt);
            else fail('failed-precondition', '참가 중인 방에서 먼저 나와 주세요.');
          }
        }
        if (action === 'create') {
          const classId = actor.manager ? data.classId : actor.classId;
          const classroom = actor.manager ? await readClass(transaction, scope, classId) : actor.classroom;
          const day = new Date(receivedAt + 9 * 3600000).toISOString().slice(0, 10);
          if (player.createDay === day && Number(player.createCount || 0) >= 40) fail('resource-exhausted', '오늘 만들 수 있는 방 수를 초과했습니다.');
          roomId = hash(`${scope.id}\n${actor.uid}\n${data.requestKey}`).slice(0, 40);
          const existing = (await transaction.get(ref(scope, 'yut_rooms', roomId))).data();
          if (existing) fail('already-exists', '처리된 방 만들기 요청입니다. 대기실을 새로 불러와 주세요.');
          codeRef = ref(scope, 'yut_codes', generatedCode);
          const existingCode = (await transaction.get(codeRef)).data();
          if (existingCode && existingCode.expiresAtMs > receivedAt) fail('unavailable', '참가 코드를 다시 만들고 있습니다. 한 번 더 눌러 주세요.');
          room = core.createYutRoom({ id: roomId, code: generatedCode, classId, classLabel: classLabel(classroom), host: { uid: actor.uid, name: actor.name }, nowMs: receivedAt });
          room.enrollmentIds = { [actor.uid]: actor.enrollmentId };
          room.enrollmentSlotIds = { [actor.uid]: actor.slotId };
          player.createCount = player.createDay === day ? Number(player.createCount || 0) + 1 : 1;
          player.createDay = day;
        } else {
          const codeData = (await transaction.get(ref(scope, 'yut_codes', code))).data();
          if (!codeData || codeData.expiresAtMs <= receivedAt || !identifier(codeData.roomId)) fail('not-found', '참가 코드를 확인해 주세요.');
          roomId = codeData.roomId;
          room = (await transaction.get(ref(scope, 'yut_rooms', roomId))).data();
          await checkRoomClass(transaction, scope, actor, room);
          try { room = core.addYutPlayer(room, { uid: actor.uid, name: actor.name }, receivedAt); }
          catch (error) { fail('failed-precondition', error.message); }
          room.enrollmentIds = { ...(room.enrollmentIds || {}), [actor.uid]: actor.enrollmentId };
          room.enrollmentSlotIds = { ...(room.enrollmentSlotIds || {}), [actor.uid]: actor.slotId };
        }
      } else {
        roomId = data.roomId;
        room = (await transaction.get(ref(scope, 'yut_rooms', roomId))).data();
        await checkRoomClass(transaction, scope, actor, room);
        const participant = room.participantUids.includes(actor.uid);
        if (!participant && !(action === 'close' && actor.manager)) fail('permission-denied', '참가 중인 방에서만 이용할 수 있습니다.');
        if (room.revision !== data.expectedRevision) fail('aborted', '다른 참가자의 동작이 먼저 반영되었습니다. 최신 화면에서 다시 눌러 주세요.');
        if (['start', 'close'].includes(action) && room.hostUid !== actor.uid && !(action === 'close' && actor.manager)) fail('permission-denied', '방장만 시작하거나 방을 닫을 수 있습니다.');
        if (action === 'start') {
          // A roster transfer or account removal after ready must not start a
          // match whose participant can no longer subscribe to this classroom.
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
              if (enrollment.studentUid !== member.uid || enrollment.semesterId !== scope.id || enrollment.classId !== room.classId
                || enrollment.enrollmentStatus !== 'ACTIVE' || enrollment.readOnly === true || slot.studentUid !== member.uid
                || slot.semesterId !== scope.id || slot.activeEnrollmentId !== enrollmentId || (slot.status !== undefined && slot.status !== 'ACTIVE')) fail('failed-precondition', '참가자의 학급 정보가 변경되었습니다. 대기실을 다시 만들어 주세요.');
            }
          }
        }
        try {
          if (action === 'ready') room = core.readyYutPlayer(room, actor.uid, data.ready, receivedAt);
          if (action === 'start') room = core.startYutGame(room, receivedAt);
          if (action === 'throw') room = core.throwYut(room, actor.uid, sticks, receivedAt);
          if (action === 'move') room = core.moveYut(room, actor.uid, data.pieceId, data.route, receivedAt);
          if (action === 'skip') room = core.skipYutTurn(room, receivedAt);
          if (action === 'leave') room = core.leaveYutRoom(room, actor.uid, receivedAt);
          if (action === 'close') room = core.closeYutRoom(room, receivedAt);
        } catch (error) { fail('failed-precondition', error.message); }
      }
      const returnedRoomId = action === 'leave' || action === 'close' ? null : roomId;
      if (transferredRoom) transaction.set(ref(scope, 'yut_rooms', transferredRoom.id), transferredRoom);
      transaction.set(ref(scope, 'yut_rooms', roomId), room);
      if (codeRef) transaction.set(codeRef, { roomId, expiresAtMs: room.expiresAtMs });
      const pointerRoomId = returnedRoomId || (player.roomId === roomId ? null : player.roomId || null);
      transaction.set(playerRef, { ...player, roomId: pointerRoomId, lastCommandAtMs: receivedAt,
        commands: [...history, { key: data.requestKey, fingerprint, roomId: returnedRoomId }].slice(-32) });
      return { room: returnedRoomId ? publicRoom(room) : null, serverNowMs: receivedAt };
    });
  };
  return { getYutLobby, commandYutRoom };
}

module.exports = { createYutHandlers };
