const { createHash, randomUUID } = require('node:crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { buildEnrollmentSlotId } = require('./productionGateway/archiveEnrollment');
const { SCOPE_FIELDS, sourceVersionOf, readAchievementProjections, updateAchievementProjection } = require('./quizAchievementProjection');
const { paperMaterialHash } = require('./quizQuestionCorrections');

const hash = value => createHash('sha256').update(value).digest('hex');
const text = value => String(value ?? '').trim();
const root = scope => `years/${scope.slice(0, 4)}/semesters/${scope.slice(-1)}`;
const statePath = scope => `quiz_class_analysis_state/${scope}`;
const classPath = (scope, id) => `${statePath(scope)}/classes/${hash(id)}`;
const data = snapshot => snapshot?.exists ? snapshot.data() : {};
const category = value => text(value).startsWith('exam_prep__round_') ? 'exam_prep' : text(value);
const scopeOf = value => {
  const parts = text(value?.definitionId).split(':'), raw = text(value?.category || parts[3]);
  return { unitId: text(value?.sourceId || value?.unitId || parts[2]), category: category(raw),
    examRound: category(raw) === 'exam_prep' ? text(value?.examRound || parts[4] || raw.split('__')[1]) || 'round_1' : '' };
};
const matches = (value, query, cumulative = false) => {
  const scope = scopeOf(value);
  return !!query.keyword || scope.unitId === query.unitId && scope.category === query.category
    && (scope.examRound === query.examRound || cumulative && Number(scope.examRound.slice(6)) <= Number(query.examRound.slice(6)));
};
const contextVersion = (scope, value) => hash(JSON.stringify([scope, value.rosterGeneration || '']));
const fail = (reason, message = '명단이 변경되었습니다. 분석을 다시 조회해 주세요.') => {
  throw new HttpsError('failed-precondition', message, { reason });
};
// One current change marker per source document: no answer/image duplication,
// no retention gap, and a monotonically committed cursor for every class.
async function recordChange(db, path, entry, event, updates = {}, extraWrites = []) {
  const ref = db.doc(path), change = db.doc(`${path}/changes/${hash(`${entry.kind}:${entry.source || ''}:${entry.id}`)}`);
  const eventId = text(event.id);
  const timestamp = event.data?.after?.updateTime;
  const match = text(event.time).match(/^(.{19})(?:\.(\d{1,9}))?Z$/);
  const seconds = timestamp?.seconds ?? (match ? Date.parse(`${match[1]}Z`) / 1000 : null);
  const nanos = timestamp?.nanoseconds ?? (match ? Number((match[2] || '').padEnd(9, '0')) : 0);
  const eventOrder = Number.isFinite(seconds) ? `${String(seconds).padStart(16, '0')}${String(nanos).padStart(9, '0')}` : '';
  return db.runTransaction(async tx => {
    const [stateSnapshot, previousSnapshot] = await tx.getAll(ref, change);
    const state = data(stateSnapshot), previous = data(previousSnapshot);
    const questionIds = entry.kind === 'question'
      ? [...new Set([...(previous.questionIds || []), ...(entry.questionIds || [])])] : undefined;
    const obsolete = eventId && previous.eventId === eventId
      || eventOrder && previous.eventOrder && eventOrder <= previous.eventOrder;
    // A delayed rename can add an older logical question ID that a connected
    // view still holds. Keep that removal identity without reverting content.
    if (obsolete && (!questionIds || questionIds.length === (previous.questionIds || []).length)) return false;
    const sequence = Number(state.sequence || 0) + 1;
    if (!Number.isSafeInteger(sequence)) fail('QUIZ_ANALYSIS_CURSOR_INVALID');
    tx.set(change, { ...(obsolete ? previous : entry), ...(questionIds ? { questionIds } : {}), sequence,
      eventId: obsolete ? previous.eventId : eventId, eventOrder: obsolete ? previous.eventOrder : eventOrder,
      updatedAt: FieldValue.serverTimestamp() });
    tx.set(ref, { ...state, ...updates, sequence, updatedAt: FieldValue.serverTimestamp() });
    for (const [extraRef, value] of extraWrites) tx.set(extraRef, value);
    return true;
  });
}

function createLiveRecorder({ db }) {
  const result = async event => {
    const source = event.params?.year ? 'legacy' : 'canonical';
    const targets = new Map(), scopes = new Map(), owners = new Map();
    for (const snapshot of [event.data?.before, event.data?.after]) {
      if (!snapshot?.exists) continue;
      const value = snapshot.data();
      if (source === 'canonical' && value.assessmentKind !== 'QUIZ') continue;
      const semesterId = source === 'legacy' ? `${event.params.year}-${event.params.semester}` : value.semesterId;
      if (!/^\d{4}-[12]$/.test(semesterId)) continue;
      const uid = text(value.studentUid || value.uid || value.studentId || value.userId);
      const ids = new Set([text(value.classId)].filter(Boolean));
      const ownerKey = `${semesterId}:${uid}`;
      if (uid && !owners.has(ownerKey)) {
        const slot = data(await db.doc(`semester_enrollment_slots/${buildEnrollmentSlotId(semesterId, uid)}`).get());
        const enrollment = slot.activeEnrollmentId ? data(await db.doc(`semester_enrollments/${slot.activeEnrollmentId}`).get()) : {};
        owners.set(ownerKey, enrollment.semesterId === semesterId && enrollment.studentUid === uid ? enrollment.classId : '');
      }
      if (owners.get(ownerKey)) ids.add(owners.get(ownerKey));
      const entries = scopes.get(semesterId) || [];
      entries.push(scopeOf(value)); scopes.set(semesterId, entries);
      if (!ids.size) targets.set(statePath(semesterId), { semesterId });
      for (const id of ids) targets.set(classPath(semesterId, id), { semesterId, classId: id });
    }
    for (const [path, target] of targets) {
      // The existing history invalidation commits with its change cursor. A
      // crash followed by a duplicate delivery cannot leave that cache stale.
      const extraWrites = [...owners.keys()].filter(key => key.startsWith(`${target.semesterId}:`)).map(key => {
        const semesterId = target.semesterId, uid = key.slice(semesterId.length + 1);
        return [db.doc(`quiz_analysis_student_revisions/${hash(`${semesterId}\n${uid}`)}`), {
          semesterId, studentUid: uid, generation: randomUUID(), updatedAt: FieldValue.serverTimestamp(),
        }];
      });
      await recordChange(db, path, {
        kind: 'result', source, id: event.params.resultId, semesterId: target.semesterId,
        scopes: scopes.get(target.semesterId) || [],
      }, event, { ...target, ...(target.classId ? { generation: randomUUID() } : { contentGeneration: randomUUID() }) }, extraWrites);
    }
    // Derived acceleration must never prevent the existing live cursor/history
    // invalidation. A failed/stale view is ignored by version-checked readers.
    try { await updateAchievementProjection(db, event); }
    catch { console.warn('Quiz achievement projection refresh failed; exact-source fallback remains available.'); }
  };
  const question = async event => {
    const semesterId = `${event.params.year}-${event.params.semester}`;
    if (!/^\d{4}-[12]$/.test(semesterId)) return;
    await recordChange(db, statePath(semesterId), { kind: 'question', id: event.params.questionId,
      semesterId, questionIds: [...new Set([event.data?.before, event.data?.after].filter(snapshot => snapshot?.exists)
        .map(snapshot => text(snapshot.data().id ?? event.params.questionId)))],
      scopes: [event.data?.before, event.data?.after].filter(snapshot => snapshot?.exists).map(snapshot => scopeOf(snapshot.data())) },
    event, { semesterId, catalogGeneration: randomUUID(), contentGeneration: randomUUID() });
  };
  return { result, question };
}

function createLiveReader({ db, json, resultFields, scoreFields, questionFields, adaptRecords,
  buildMockExamScoreRows, effectiveQuizResult = value => value, prepareAchievementRows = () => {} }) {
  const state = async (semesterId, classes) => {
    const snapshots = await db.getAll(db.doc(statePath(semesterId)), ...classes.map(item => db.doc(classPath(semesterId, item.id))));
    return { contextVersion: contextVersion(semesterId, data(snapshots[0])), rosterGeneration: data(snapshots[0]).rosterGeneration || '',
      contentGeneration: data(snapshots[0]).contentGeneration || '', statePath: statePath(semesterId),
      contentCursor: Number(data(snapshots[0]).sequence || 0), classes: classes.map((item, index) => ({
        classId: item.id, statePath: classPath(semesterId, item.id), cursor: Number(data(snapshots[index + 1]).sequence || 0),
      })) };
  };
  const changes = async query => {
    const compactAchievement = query.liveMode === 'achievement' && query.analysisProjection === 'compact-v1';
    const refs = query.cursors.map(item => db.doc(`semester_classes/${item.classId}`));
    const classes = (await db.getAll(...refs)).map((snapshot, index) => ({ ...data(snapshot), id: query.cursors[index].classId }));
    if (classes.some(item => item.semesterId !== query.semesterId || item.status !== 'ACTIVE'
      || query.grade && String(item.grade) !== query.grade || !query.grade && !query.classIds.includes(item.id)
        && (!query.comparisonGrade || String(item.grade) !== query.comparisonGrade)))
      fail('QUIZ_ANALYSIS_CLASS_INVALID');
    const live = await state(query.semesterId, classes);
    if (live.contextVersion !== query.contextVersion) fail('QUIZ_ANALYSIS_LIVE_SCOPE_CHANGED');
    const selectedClasses = new Set(classes.map(item => item.id));
    const checkpoints = [
      { path: live.statePath, before: query.contentCursor, through: live.contentCursor, target: live, key: 'contentCursor' },
      ...live.classes.map(item => ({ path: item.statePath,
        before: query.cursors.find(cursor => cursor.classId === item.classId).cursor, through: item.cursor, target: item, key: 'cursor' })),
    ];
    const rawRows = [], removedKeys = new Set(), questionUpserts = [], questionRemovedIds = new Set(), allRows = [], owners = new Map();
    const seenResults = new Set();
    let count = 0, bytes = 0, hasMore = false;
    const owner = async raw => {
      let uid = text(raw.studentUid || raw.uid || raw.studentId || raw.userId);
      if (!uid && (raw.email || raw.studentEmail)) {
        const found = await db.collection('users').where('email', '==', text(raw.email || raw.studentEmail)).select('email').limit(2).get();
        if (found.docs.length === 1) uid = found.docs[0].id;
      }
      if (!uid) return null;
      if (!owners.has(uid)) {
        const slot = data(await db.doc(`semester_enrollment_slots/${buildEnrollmentSlotId(query.semesterId, uid)}`).get());
        const enrollment = slot.activeEnrollmentId ? data(await db.doc(`semester_enrollments/${slot.activeEnrollmentId}`).get()) : {};
        owners.set(uid, enrollment.semesterId === query.semesterId && enrollment.studentUid === uid
          && enrollment.enrollmentStatus === 'ACTIVE' && selectedClasses.has(enrollment.classId)
          ? { uid, classId: enrollment.classId, email: text(raw.email || raw.studentEmail) } : null);
      }
      return owners.get(uid);
    };
    for (const checkpoint of checkpoints) {
      if (checkpoint.before > checkpoint.through) fail('QUIZ_ANALYSIS_CURSOR_INVALID');
      checkpoint.target[checkpoint.key] = checkpoint.before;
      if (checkpoint.before === checkpoint.through) continue;
      if (count >= 25 || bytes > 4 * 1024 * 1024) { hasMore = true; continue; }
      const events = await db.collection(`${checkpoint.path}/changes`).where('sequence', '>', checkpoint.before)
        .where('sequence', '<=', checkpoint.through).orderBy('sequence').limit(26 - count).get();
      let consumed = true;
      for (const snapshot of events.docs) {
        if (count >= 25 || bytes > 4 * 1024 * 1024) { hasMore = true; consumed = false; break; }
        const event = snapshot.data(); count++;
        if (event.semesterId !== query.semesterId) fail('QUIZ_ANALYSIS_CURSOR_INVALID');
        // Markers coalesce successive moves between rounds/units. Remove the
        // former row even if none of the latest scopes matches this view, and
        // read the source body only when it can contribute a current row.
        if (event.kind === 'question') for (const id of event.questionIds || [event.id]) questionRemovedIds.add(id);
        else if (['canonical', 'legacy'].includes(event.source)) removedKeys.add(`${event.source}:${event.id}`);
        if ((event.scopes || []).some(item => matches(item, query, query.liveMode === 'achievement'))) {
          if (event.kind === 'question') {
            const questionRef = db.doc(`${root(query.semesterId)}/quiz_questions/${event.id}`);
            const current = compactAchievement
              ? (await db.getAll(questionRef, { fieldMask: [...questionFields, 'answer'] }))[0]
              : await questionRef.get();
            const raw = data(current);
            if (current.exists && matches(raw, query)) {
              const fields = query.liveMode === 'summary' ? questionFields.filter(field => field !== 'question') : Object.keys(raw);
              const question = { ...json(Object.fromEntries(fields.filter(field => Object.hasOwn(raw, field)).map(field => [field, raw[field]]))),
                ...(!compactAchievement && query.liveMode === 'detail' && paperMaterialHash(raw)
                  ? { paperMaterialHash: paperMaterialHash(raw) } : {}),
                id: raw.id ?? Number(event.id), docId: event.id, sourceRevision: String(raw.contentRevision || raw.revision || 'legacy') };
              questionUpserts.push(question); bytes += Buffer.byteLength(JSON.stringify(question));
            }
          } else if (['canonical', 'legacy'].includes(event.source)) {
            const key = `${event.source}:${event.id}`;
            if (seenResults.has(key)) { checkpoint.target[checkpoint.key] = event.sequence; continue; }
            seenResults.add(key);
            const path = event.source === 'canonical' ? `semester_assessment_results/${event.id}` : `${root(query.semesterId)}/quiz_results/${event.id}`;
            const priorOnly = query.liveMode === 'achievement' && !(event.scopes || []).some(item => matches(item, query));
            const compact = compactAchievement;
            const fields = compact ? SCOPE_FIELDS : priorOnly ? scoreFields : query.liveMode === 'summary' ? resultFields.filter(field => field !== 'questionSnapshots') : resultFields;
            let [current] = await db.getAll(db.doc(path), { fieldMask: fields });
            let raw = current.exists ? compact ? json(current.data()) : effectiveQuizResult(current.data()) : null;
            if (compact && raw) {
              if ((!raw.semesterId || raw.semesterId === query.semesterId)
                && (event.source !== 'canonical' || raw.semesterId === query.semesterId && raw.assessmentKind === 'QUIZ')
                && matches(raw, query, true) && await owner(raw)) {
                const [projected] = await readAchievementProjections({ db, json, entries: [{
                  id: event.id, source: event.source, path, scope: raw, sourceVersion: sourceVersionOf(current),
                }] });
                raw = projected.raw;
              } else raw = null;
            }
            if (!compact && priorOnly && raw && matches(raw, query)) {
              [current] = await db.getAll(db.doc(path), { fieldMask: resultFields });
              raw = current.exists ? effectiveQuizResult(current.data()) : null;
            }
            if (raw && (!raw.semesterId || raw.semesterId === query.semesterId)
              && (event.source !== 'canonical' || raw.semesterId === query.semesterId && raw.assessmentKind === 'QUIZ')
              && matches(raw, query, query.liveMode === 'achievement') && await owner(raw)) {
              const value = json(raw);
              if (compact && !text(value.studentUid || value.uid || value.studentId || value.userId))
                value.studentUid = (await owner(raw)).uid;
              value.behaviorAnswersAvailable = event.source === 'canonical' && !!raw.answers && typeof raw.answers === 'object';
              if (query.liveMode !== 'summary' && matches(raw, query) && event.source === 'canonical'
                && (!value.answers || typeof value.answers !== 'object' || Array.isArray(value.answers))) {
                const id = text(value.submissionRef).match(/^semester_assessment_submissions\/([^/]+)$/)?.[1] || text(value.attemptId || event.id);
                if (/^[^/\x00-\x1f]{1,180}$/.test(id)) {
                  const [submissionDoc] = await db.getAll(db.doc(`semester_assessment_submissions/${id}`),
                    { fieldMask: ['studentUid', 'semesterId', 'attemptId', 'definitionId', 'answers'] });
                  const submission = data(submissionDoc);
                  if (submission.studentUid === raw.studentUid && submission.semesterId === query.semesterId
                    && (!submission.attemptId || submission.attemptId === (raw.attemptId || event.id))
                    && (!submission.definitionId || submission.definitionId === raw.definitionId)
                    && submission.answers && typeof submission.answers === 'object' && !Array.isArray(submission.answers))
                    value.answers = json(submission.answers);
                }
              }
              const row = { id: event.id, source: event.source, raw: value };
              allRows.push(row);
              if (matches(raw, query)) rawRows.push(row);
              bytes += Buffer.byteLength(JSON.stringify(value));
            }
          }
        }
        checkpoint.target[checkpoint.key] = event.sequence;
      }
      // Replaced markers may have moved beyond through while the query ran.
      // Advancing to through is safe: their new sequence remains pending.
      if (consumed) checkpoint.target[checkpoint.key] = checkpoint.through;
    }
    if ((await state(query.semesterId, classes)).contextVersion !== query.contextVersion) fail('QUIZ_ANALYSIS_LIVE_SCOPE_CHANGED');
    const students = [...owners.values()].filter(Boolean);
    if (query.liveMode === 'achievement' && query.analysisProjection !== 'compact-v1') prepareAchievementRows(rawRows);
    const scoreRows = query.liveMode === 'achievement' ? await buildMockExamScoreRows(allRows, students, query, { documents: 0, bytes: 0 }) : [];
    return { semesterId: query.semesterId, rawRows: query.liveMode === 'summary' ? [] : rawRows,
      records: query.liveMode === 'summary' ? adaptRecords(rawRows, students, query.semesterId) : [],
      removedKeys: [...removedKeys], questionUpserts, questionRemovedIds: [...questionRemovedIds],
      mockExamScoreRows: scoreRows, live, hasMore, generatedAt: new Date().toISOString() };
  };
  return { state, changes };
}

module.exports = { createLiveRecorder, createLiveReader, scopeOf, matches, contextVersion };
