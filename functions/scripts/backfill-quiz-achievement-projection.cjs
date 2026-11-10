'use strict';

const { Firestore, FieldPath } = require('@google-cloud/firestore');
const { OAuth2Client } = require('google-auth-library');
const { resolveCredential } = require('./rebuild-wis-ranking-index.cjs');
const { SCOPE_FIELDS, PROJECTION_INPUT_FIELDS, sourceVersionOf, projectionRef, buildAchievementProjection, validProjection } = require('../quizAchievementProjection');

function parseArgs(args) {
  const options = { project: 'history-quiz-yongsin', apply: false };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--apply') { options.apply = true; continue; }
    if (args[index] === '--help') { options.help = true; continue; }
    const [key, inline] = args[index].split('=', 2);
    if (!['--project', '--semester', '--unit', '--round'].includes(key)) throw new Error('Unsupported argument.');
    const value = inline ?? args[++index];
    if (!value || value.startsWith('--')) throw new Error('Missing argument.');
    options[key.slice(2)] = value;
  }
  if (!options.help && (!/^\d{4}-[12]$/.test(options.semester || '') || !/^round_[1-9]\d*$/.test(options.round || '')
    || !/^[^/\x00-\x1f]{1,180}$/.test(options.unit || '') || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(options.project)))
    throw new Error('Explicit semester, unit and round are required.');
  return options;
}

const json = value => value?.toDate ? value.toDate().toISOString() : Array.isArray(value) ? value.map(json)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, json(item)])) : value;
const scopeMatches = (raw, options) => {
  const parts = String(raw.definitionId || '').split(':'), category = String(raw.category || parts[3] || '');
  const round = raw.examRound || parts[4] || category.split('__')[1] || 'round_1';
  return (!raw.semesterId || raw.semesterId === options.semester) && (raw.sourceId || raw.unitId || parts[2]) === options.unit
    && (category === 'exam_prep' || category.startsWith('exam_prep__')) && round === options.round;
};

async function runBackfill({ db, options }) {
  const totals = { mode: options.apply ? 'apply' : 'dry-run', candidates: 0, unchanged: 0, converted: 0, written: 0,
    stale: 0, originalBytes: 0, projectionBytes: 0 };
  const root = `years/${options.semester.slice(0, 4)}/semesters/${options.semester.slice(-1)}`, entries = new Map();
  const canonical = () => db.collection('semester_assessment_results').where('semesterId', '==', options.semester).where('assessmentKind', '==', 'QUIZ');
  const definitions = [
    `quiz:${options.semester}:${options.unit}:exam_prep:${options.round}`,
    `quiz:${options.semester}:${options.unit}:exam_prep__${options.round}`,
    ...(options.round === 'round_1' ? [`quiz:${options.semester}:${options.unit}:exam_prep`] : []),
  ].map(value => value.replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 180));
  const queries = [
    ['canonical', canonical().where('sourceId', '==', options.unit)],
    ['canonical', canonical().where('definitionId', 'in', definitions)],
    ['legacy', db.collection(`${root}/quiz_results`).where('unitId', '==', options.unit)],
  ];
  for (const [source, query] of queries) {
    let cursor;
    do {
      let page = query.select(...SCOPE_FIELDS).orderBy(FieldPath.documentId()).limit(250);
      if (cursor) page = page.startAfter(cursor);
      const snapshot = await page.get();
      for (const doc of snapshot.docs) {
        const scope = json(doc.data());
        if (scopeMatches(scope, options)) entries.set(doc.ref.path, { id: doc.id, source, path: doc.ref.path, scope, sourceVersion: sourceVersionOf(doc) });
      }
      if (entries.size > 10000) throw new Error('Selected result bound exceeded.');
      cursor = snapshot.size === 250 ? snapshot.docs.at(-1) : undefined;
    } while (cursor);
  }
  totals.candidates = entries.size;
  const pending = [...entries.values()]; let cursor = 0, failure;
  const processEntry = async entry => {
    const viewRef = projectionRef(db, entry.path), sourceRef = db.doc(entry.path);
    const saved = await viewRef.get();
    if (saved.exists && validProjection(saved.data(), entry)) { totals.unchanged++; return; }
    const [source] = await db.getAll(sourceRef, { fieldMask: PROJECTION_INPUT_FIELDS });
    if (!source.exists || sourceVersionOf(source) !== entry.sourceVersion) { totals.stale++; return; }
    const raw = source.data();
    if (!scopeMatches(raw, options)) { totals.stale++; return; }
    totals.originalBytes += Buffer.byteLength(JSON.stringify(raw));
    if (totals.originalBytes > 256 * 1024 * 1024) throw new Error('Original processing byte bound exceeded.');
    const projection = buildAchievementProjection({ sourcePath: entry.path, source: entry.source,
      sourceVersion: entry.sourceVersion, semesterId: options.semester, raw });
    totals.projectionBytes += Buffer.byteLength(JSON.stringify(projection));
    totals.converted++;
    if (!options.apply) return;
    const outcome = await db.runTransaction(async tx => {
      const [current] = await tx.getAll(sourceRef, { fieldMask: SCOPE_FIELDS });
      if (!current.exists || sourceVersionOf(current) !== entry.sourceVersion || !scopeMatches(current.data(), options)) return 'stale';
      // A concurrent trigger may already have written this version. Inspect the
      // view separately because its shape is outside the source field mask.
      const savedView = await tx.get(viewRef);
      if (savedView.exists && validProjection(savedView.data(), entry)) return 'unchanged';
      if (savedView.exists && savedView.data().sourceVersion > entry.sourceVersion) return 'stale';
      tx.set(viewRef, projection);
      return 'written';
    });
    totals[outcome]++;
  };
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
    while (!failure && cursor < pending.length) {
      const entry = pending[cursor++];
      try { await processEntry(entry); } catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
  return totals;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log('node functions/scripts/backfill-quiz-achievement-projection.cjs --semester YYYY-S --unit ID --round round_N [--project ID] [--apply]'); return; }
  // Native Firestore accepts an AuthClient; firebase-admin rejects a custom
  // credential when ADC is absent. Keep both ADC and gcloud fallback tokens
  // entirely in memory, including refreshes during longer scoped backfills.
  const credential = await resolveCredential(), authClient = new OAuth2Client();
  authClient.refreshHandler = async () => {
    const token = await credential.getAccessToken();
    return { access_token: token.access_token, expiry_date: Date.now() + token.expires_in * 1000 };
  };
  authClient.setCredentials(await authClient.refreshHandler());
  const db = new Firestore({ projectId: options.project, authClient });
  try { console.log(JSON.stringify(await runBackfill({ db, options }))); }
  finally { await db.terminate(); }
}
if (require.main === module) main().catch(() => {
  console.error('Quiz achievement projection backfill failed. Check explicit scope, credentials and source bounds.');
  process.exitCode = 1;
});
module.exports = { parseArgs, runBackfill };
