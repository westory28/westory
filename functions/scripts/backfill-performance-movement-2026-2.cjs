const { createHash, randomUUID } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { parseArgs } = require('node:util');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { resolveCredential } = require('./rebuild-wis-ranking-index.cjs');
const { getEnrollmentRosterUpdate } = require('../studentRoster');

const PROJECT = 'history-quiz-yongsin', YEAR = '2026', SEMESTER = '2', SCOPE = '2026-2';
const ROOT = 'years/2026/semesters/2', START = '2026-08-14';
const AUDIT = 'performance-movement-2026-2-v1';
const movement = ['transferred', 'outside_quota'];
const fields = ['enrollmentStatus', 'enrollmentReason', 'enrollmentYear', 'enrollmentSemester',
  'enrollmentMovementDate', 'enrollmentMovementTiming'];

class GuardError extends Error {}
const check = (condition, message) => { if (!condition) throw new GuardError(message); };
const pick = (v, keys) => Object.fromEntries(keys.filter(k => Object.hasOwn(v, k)).map(k => [k, v[k]]));
const same = (data, wanted) => Object.entries(wanted).every(([key, value]) => data[key] === value);
const norm = value => String(value ?? '').normalize('NFC').trim();
const coords = data => [data.grade ?? data.studentGrade, data.class ?? data.classNumber ?? data.studentClass,
  data.number ?? data.studentNumber].map(v => norm(v).replace(/^(\d+)\D*$/, '$1').replace(/^0+(?=\d)/, '')).join('/');
const named = (data, name) => [data.studentName, data.name, data.displayName].some(value => norm(value) === name);
const exact = (data, entry) => named(data, entry.name) && coords(data) === entry.slot;
const version = doc => doc.exists ? [doc.ref.path, doc.updateTime.seconds, doc.updateTime.nanoseconds] : [doc.ref.path, null];
// Hash in memory. Only a boolean is reported; the backup contains enrollment
// metadata, never the underlying scores, signatures or student names.
function scoreDigest(data) {
  const content = { ...data };
  for (const field of [...fields, 'enrollmentUpdatedAt', 'enrollmentUpdatedBy']) delete content[field];
  const sortable = (_key, value) => value && value.constructor === Object
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value;
  return createHash('sha256').update(JSON.stringify(content, sortable)).digest('hex');
}

function readInput(filename) {
  check(filename, '--input must name the private JSON file.');
  const rows = JSON.parse(readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  check(Array.isArray(rows) && rows.length === 11, 'Expected eleven confirmed movements.');
  const entries = rows.map((row, index) => {
    check(Array.isArray(row) && row.length === 6, 'Each input row needs grade, class, number, name, status, date.');
    const [grade, classNumber, number, name, status, date] = row.map(norm);
    const slot = [grade, classNumber, number].join('/');
    check(/^3\/[1-9]\d*\/[1-9]\d*$/.test(slot) && name && movement.includes(status) &&
      /^2026-\d\d-\d\d$/.test(date) && new Date(date).toISOString().slice(0, 10) === date, 'Invalid private manifest.');
    return { row: index + 1, slot, name, status, date, timing: date < START ? 'before' : 'during' };
  });
  check(new Set(entries.map(e => e.slot)).size === entries.length &&
    entries.filter(e => e.status === 'outside_quota').length === 1 &&
    entries.filter(e => e.timing === 'during').length === 1, 'The confirmed cohort has changed.');
  return entries;
}

async function readPlan(db, tx, input) {
  const settingsRef = db.doc(ROOT + '/assessment_config/enrollment_movement');
  const [config, pointer, manifest, boundary, profiles, enrollments, rosters] = await Promise.all([
    tx.get(db.doc('site_settings/config')), tx.get(db.doc('site_settings/semester_active')),
    tx.get(db.doc('semester_manifests/' + SCOPE)), tx.get(settingsRef),
    tx.get(db.collection('users').select('role', 'studentName', 'name', 'grade', 'studentGrade',
      'class', 'studentClass', 'number', 'studentNumber', 'registrationApprovalStatus', ...fields,
      'enrollmentUpdatedBy', 'enrollmentUpdatedAt', 'updatedAt')),
    tx.get(db.collection('semester_enrollments').where('semesterId', '==', SCOPE).select(
      'studentUid', 'snapshot', 'rosterExclusionStatus', 'rosterExclusionReason', 'rosterExclusionMovementDate',
      'rosterExclusionMovementTiming', 'rosterExclusionUpdatedAt', 'rosterExclusionUpdatedBy')),
    tx.get(db.collection(ROOT + '/performance_score_rosters')),
  ]);
  check(String(config.data()?.year) === YEAR && String(config.data()?.semester) === SEMESTER &&
    pointer.data()?.semesterId === SCOPE && manifest.data()?.status === 'ACTIVE' &&
    manifest.data().revision === pointer.data().revision && manifest.data().readOnly !== true,
  'The correction requires the active, writable 2026-2 semester.');
  check(!boundary.exists || boundary.data().startDate === START, 'Another assessment semester boundary is configured.');
  const versions = [pointer, manifest, boundary], updates = [], creates = [], backup = [], missing = [];
  const effective = new Map(), timestamp = FieldValue.serverTimestamp(), scoreDigests = [];
  let linkedAssessments = 0, during = 0, quota = 0;
  if (!boundary.exists) creates.push({ ref: settingsRef, data: { startDate: START } });
  const queue = (doc, wanted, stamps) => {
    if (same(doc.data(), wanted)) return;
    const patch = { ...wanted, ...stamps };
    backup.push({ path: doc.ref.path, fields: Object.keys(patch), before: pick(doc.data(), Object.keys(patch)) });
    updates.push({ ref: doc.ref, patch });
  };
  for (const entry of input) {
    const names = profiles.docs.filter(d => named(d.data(), entry.name));
    const slots = profiles.docs.filter(d => coords(d.data()) === entry.slot);
    const matches = names.filter(d => slots.includes(d));
    const canonicalMatches = enrollments.docs.filter(d => exact(d.data().snapshot || {}, entry));
    if (!matches.length) {
      check(!slots.length && !names.length && !canonicalMatches.length && entry.timing === 'before' &&
        !rosters.docs.some(d => (d.data().rows || []).some(row => exact(row, entry))),
      'A private manifest entry partially matches a student or a saved roster. Inspect the roster.');
      missing.push(entry.row);
      continue;
    }
    check(matches.length === 1 && slots.length === 1, 'A name and roster position must resolve uniquely.');
    const student = matches[0], user = student.data(), status = user.enrollmentStatus || 'active';
    check(user.role === 'student' && (!Object.hasOwn(user, 'registrationApprovalStatus') ||
      user.registrationApprovalStatus === 'APPROVED'), 'Only approved students may be updated.');
    check((status === 'active' || status === entry.status) &&
      (!user.enrollmentMovementTiming || (status === entry.status && user.enrollmentMovementTiming === entry.timing)) &&
      (!user.enrollmentMovementDate || user.enrollmentMovementDate === entry.date) &&
      (status === 'active' || (String(user.enrollmentYear) === YEAR && String(user.enrollmentSemester) === SEMESTER)),
    'An existing classification conflicts with the manifest.');
    const byUid = enrollments.docs.filter(d => d.data().studentUid === student.id);
    check(byUid.length === 1 && canonicalMatches.length === 1 && byUid[0].id === canonicalMatches[0].id,
      'The official enrollment does not confirm the same student, name and roster position.');
    const canonical = byUid[0], previous = canonical.data().rosterExclusionStatus || 'active';
    check(previous === status || previous === entry.status, 'The student and official roster statuses disagree.');
    const wanted = { enrollmentStatus: entry.status, enrollmentReason: user.enrollmentReason || '',
      enrollmentYear: YEAR, enrollmentSemester: SEMESTER, enrollmentMovementDate: entry.date,
      enrollmentMovementTiming: entry.timing };
    effective.set(student.id, { entry, wanted, profile: user });
    during += Number(entry.timing === 'during');
    quota += Number(entry.status === 'outside_quota');
    const historyRef = student.ref.collection('enrollment_history').doc(AUDIT);
    const [scores, audit] = await Promise.all([tx.get(student.ref.collection('performance_scores')
      .select('academicYear', 'semester', ...fields, 'enrollmentUpdatedAt', 'enrollmentUpdatedBy')), tx.get(historyRef)]);
    const currentScores = scores.docs.filter(d => String(d.data().academicYear) === YEAR && String(d.data().semester) === SEMESTER);
    versions.push(student, canonical, audit, ...currentScores);
    const before = updates.length;
    const stamps = { enrollmentUpdatedBy: AUDIT, enrollmentUpdatedAt: timestamp };
    queue(student, wanted, { ...stamps, updatedAt: timestamp });
    queue(canonical, { rosterExclusionStatus: entry.status, rosterExclusionReason: wanted.enrollmentReason,
      rosterExclusionMovementDate: entry.date, rosterExclusionMovementTiming: entry.timing },
    { rosterExclusionUpdatedBy: AUDIT, rosterExclusionUpdatedAt: timestamp });
    for (const score of currentScores) {
      const full = await tx.get(score.ref);
      scoreDigests.push([score.ref.path, scoreDigest(full.data())]);
      queue(score, wanted, stamps);
    }
    if (audit.exists) check(updates.length === before && same(audit.data(), wanted), 'A previously corrected record changed.');
    else creates.push({ ref: historyRef, data: { ...wanted, ...stamps, previousStatus: status,
      previousMovementDate: user.enrollmentMovementDate ?? null, previousMovementTiming: user.enrollmentMovementTiming ?? null } });
  }
  check(effective.size === 7 && missing.length === 4 && during === 1 && quota === 1 &&
    !profiles.docs.some(d => movement.includes(d.data().enrollmentStatus) && !effective.has(d.id)),
  'The cohort differs from the seven verified students and four absent records.');
  for (const roster of rosters.docs) {
    const data = roster.data(), touched = [], seen = new Set();
    let rows = data.rows || [];
    rows.forEach((row, index) => {
      const { entry, wanted } = effective.get(row.uid) || {};
      if (!entry) {
        check(!input.some(e => exact(row, e)), 'A saved roster row is unlinked or belongs to another UID.');
        return;
      }
      check(!seen.has(row.uid) && exact(row, entry), 'An affected roster row is duplicated or has changed identity.');
      seen.add(row.uid);
      if (entry.timing === 'during' && (!data.scoreKind || data.scoreKind === 'performance')) linkedAssessments++;
      scoreDigests.push([roster.ref.path + '#' + index, scoreDigest(row)]);
      if (same(row, wanted)) return;
      touched.push({ index, uid: row.uid, fields, before: pick(row, fields) });
    });
    versions.push(roster);
    if (!touched.length) continue;
    for (const { index, uid } of touched) {
      const { entry, wanted, profile } = effective.get(uid);
      const projection = getEnrollmentRosterUpdate({ ...data, rows }, { uid, profile, status: entry.status,
        reason: wanted.enrollmentReason, year: YEAR, semester: SEMESTER, movementTiming: entry.timing, movementDate: entry.date });
      check(projection && Object.keys(projection).length === 1 && projection.rows.length === rows.length &&
        same(projection.rows[index], wanted) && scoreDigest(projection.rows[index]) === scoreDigest(rows[index]),
      'A score roster projection exceeds the verified movement metadata.');
      rows = projection.rows;
    }
    updates.push({ ref: roster.ref, patch: { rows, updatedAt: timestamp } });
    backup.push({ path: roster.ref.path, rows: touched, fields: ['updatedAt'], before: pick(data, ['updatedAt']) });
  }
  check(linkedAssessments > 0, 'The in-term movement must match a saved performance roster.');
  const fingerprint = createHash('sha256').update(JSON.stringify([input,
    versions.map(version).sort((a, b) => a[0].localeCompare(b[0])), [...effective.keys()].sort(),
    updates.map(c => c.ref.path).sort(), creates.map(c => c.ref.path).sort()])).digest('hex');
  return { updates, creates, backup, scoreDigest: JSON.stringify(scoreDigests.sort(([a], [b]) => a.localeCompare(b))),
    summary: { semesterId: SCOPE, startDate: START, matched: effective.size,
    missingInputRows: missing, during, before: effective.size - during, outsideQuota: quota, linkedAssessments,
    updatedDocuments: updates.length, createdDocuments: creates.length, fingerprint } };
}

async function main() {
  const { values } = parseArgs({ options: { input: { type: 'string' }, apply: { type: 'boolean' },
    expect: { type: 'string' } } });
  check(!values.apply || /^[a-f0-9]{64}$/.test(values.expect || ''), 'Supply the verified --expect fingerprint for --apply.');
  check(!process.env.FIRESTORE_EMULATOR_HOST, 'Unset FIRESTORE_EMULATOR_HOST for this production correction.');
  const input = readInput(values.input);
  const app = initializeApp({ projectId: PROJECT, credential: await resolveCredential() });
  try {
    const db = getFirestore(app);
    const inspect = () => db.runTransaction(tx => readPlan(db, tx, input), { readOnly: true });
    const initial = await inspect();
    if (!values.apply || (!initial.updates.length && !initial.creates.length)) {
      console.log(JSON.stringify({ mode: values.apply ? 'already-applied' : 'dry-run', ...initial.summary }));
      return;
    }
    check(initial.summary.fingerprint === values.expect, 'The verified records changed. Inspect again.');
    const backupPath = join(tmpdir(), 'westory-movement-' + randomUUID() + '.json');
    // Restore only the listed fields after checking current values and row UIDs.
    // Missing keys in before must be deleted rather than restored as null.
    writeFileSync(backupPath, JSON.stringify({ project: PROJECT, ...initial.summary, affected: initial.backup,
      createdPaths: initial.creates.map(e => e.ref.path) }), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ backupPath }));
    await db.runTransaction(async tx => {
      const plan = await readPlan(db, tx, input);
      check(plan.summary.fingerprint === values.expect, 'The verified records changed before the transaction.');
      for (const change of plan.updates) tx.update(change.ref, change.patch);
      for (const entry of plan.creates) tx.create(entry.ref, entry.data);
    });
    const verification = await inspect();
    check(!verification.updates.length && !verification.creates.length && verification.scoreDigest === initial.scoreDigest,
      'The saved classifications or score content did not verify.');
    console.log(JSON.stringify({ mode: 'applied', verified: true, scoreContentPreserved: true, ...verification.summary }));
  } finally { await deleteApp(app); }
}
if (require.main === module) main().catch(error => {
  console.error(error instanceof GuardError ? error.message : 'Correction failed. Check private input, authentication and Firestore access.');
  process.exitCode = 1;
});
