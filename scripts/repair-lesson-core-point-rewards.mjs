import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createReadOnlyRestDb } from './core-point-readonly-rest.mjs';

// Read-only maintenance planning. A plan never invokes a student session or
// creates a payout. Financial application requires a separately reviewed step.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'functions/package.json'));
const ts = require('typescript');
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object'
  && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const safeId = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('/');
const sourceNames = [
  'sanitizeKeyPart', 'buildActivityTransactionId', 'getSemesterRoot',
  'getLessonCorePointTimestampMs', 'getLessonUpdatedAtMs', 'getLatestLessonsByUnitIdForCorePoints',
  'isStudentVisibleLessonForCorePoints', 'normalizeLessonCorePointIds',
  'readEffectiveVisibleLessonCorePointCatalog', 'getLessonCorePointCompletion',
  'assertLessonCorePointActiveScope', 'resolveLessonCorePointActiveEnrollmentId',
  'assertLessonCorePointActiveEnrollment',
];
const lessonFields = ['unitId', 'title', 'updatedAt', 'createdAt', 'isVisibleToStudents',
  'deletedAt', 'assignedClassIds', 'worksheetExamHighlights'];
const enrollmentFields = ['studentUid', 'semesterId', 'enrollmentId', 'enrollmentStatus', 'classId', 'readOnly'];

export async function loadRepairContract(db, sourceDirectory = path.join(root, 'functions')) {
  const sourcePath = path.join(sourceDirectory, 'productionGateway/productionSource.js');
  const source = await fs.readFile(sourcePath, 'utf8');
  const ast = ts.createSourceFile('productionSource.js', source, ts.ScriptTarget.Latest, true);
  const declarations = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && sourceNames.includes(node.name.getText(ast)))
      declarations.set(node.name.getText(ast), `const ${node.name.getText(ast)}=${node.initializer.getText(ast)};`);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(declarations.size, sourceNames.length, 'Canonical reward contract is incomplete');
  const archive = require(path.join(sourceDirectory, 'productionGateway/archiveEnrollment.js'));
  const wis = require(path.join(sourceDirectory, 'productionGateway/wisEconomy.js'));
  const { HttpsError } = require('firebase-functions/v2/https');
  const helperSource = sourceNames.map(name => declarations.get(name)).join('\n');
  const api = vm.runInNewContext(`${helperSource}\n({completion:getLessonCorePointCompletion,
    activeScope:assertLessonCorePointActiveScope,activeEnrollment:assertLessonCorePointActiveEnrollment,
    activeSlot:resolveLessonCorePointActiveEnrollmentId,legacyId:buildActivityTransactionId});`, {
    db, HttpsError, commandGateway: { sha256: sha, canonicalize: canonical },
  });
  const sourceHash = sha(source.replace(/\r\n/g, '\n') + '\n' + await fs.readFile(path.join(sourceDirectory, 'productionGateway/archiveEnrollment.js'))
    + '\n' + await fs.readFile(path.join(sourceDirectory, 'productionGateway/wisEconomy.js')));
  return { ...api, archive, wis, sourceHash };
}

export async function buildRepairPlan({ db, year, semester, projectId, sourceDirectory, documentId }) {
  assert(/^\d{4}$/.test(year) && /^[12]$/.test(semester), 'Explicit year and semester are required');
  const semesterId = `${year}-${semester}`, semesterRoot = `years/${year}/semesters/${semester}`;
  const contract = await loadRepairContract(db, sourceDirectory);
  const reads = { queries: 0, documents: 0, emptyQueries: 0 };
  const getAll = async (refs, fieldMask) => {
    reads.documents += refs.length;
    return db.getAll(...refs.map(value => db.doc(value)), ...(fieldMask ? [{ fieldMask }] : []));
  };
  const readQuery = async query => {
    reads.queries++;
    const result = await query.get();
    reads.documents += result.docs.length;
    if (!result.docs.length) reads.emptyQueries++;
    return result;
  };
  const [config, pointer, manifest, economy, fence] = await getAll([
    'site_settings/config', 'site_settings/semester_active', `semester_manifests/${semesterId}`,
    `semester_wis_economies/${semesterId}`, `wis_legacy_migration_controls/${semesterId}`,
  ], ['year', 'semester', 'semesterId', 'activeSemesterId', 'status', 'revision', 'readOnly', 'enabled', 'writesBlocked']);
  assert.equal(`${config.data()?.year}-${config.data()?.semester}`, semesterId, 'Configured semester changed');
  contract.activeScope({ pointerSnapshot: pointer, manifestSnapshot: manifest, semesterId });
  assert(economy.exists && economy.data().status === 'ACTIVE_OPEN' && !economy.data().readOnly, 'Wis economy is not open');
  assert(!fence.data()?.enabled && !fence.data()?.writesBlocked, 'Wis migration blocks maintenance');

  // This cache lasts only for this explicit audit, not between users or runs.
  // Whole current-semester catalog is required for a complete reward decision.
  let catalogPromise;
  const catalogReader = {
    get: async ref => {
      if (ref.path === `${semesterRoot}/lessons`)
        return catalogPromise ||= readQuery(ref.select(...lessonFields));
      assert(ref.path.startsWith(`${semesterRoot}/lesson_progress/`) && ref.path.endsWith('/units'), 'Unexpected progress scope');
      return readQuery(ref.select('corePointFinds'));
    },
  };
  const rows = [], seenStudents = new Set();
  let cursor;
  do {
    let query = db.collection(contract.archive.SEMESTER_ENROLLMENT_COLLECTION)
      .where('semesterId', '==', semesterId).where('enrollmentStatus', '==', 'ACTIVE')
      .orderBy(documentId).select(...enrollmentFields).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await readQuery(query);
    const enrollmentRows = page.docs.map(enrollment => {
      const data = enrollment.data(), uid = data.studentUid;
      assert(safeId(uid) && !seenStudents.has(uid), 'Invalid or duplicate active enrollment');
      seenStudents.add(uid);
      const row = { uid, enrollmentId: enrollment.id, classId: data.classId };
      contract.activeEnrollment({ enrollmentSnapshot: enrollment, enrollmentId: enrollment.id, semesterId, uid });
      const accountId = contract.wis.accountIdFor(semesterId, uid);
      const ledgerEntryId = `wisled_${sha([semesterId, accountId, 'GRANT', 'lesson-core-points-all'].join('\n'))}`;
      return { enrollment, data, uid, row, accountId, ledgerEntryId, receiptPaths: [
        `${contract.wis.WIS_LEDGER_COLLECTION}/${ledgerEntryId}`,
        `${semesterRoot}/point_transactions/${contract.legacyId(uid, 'lesson_core_points', 'lesson-core-points-all')}`,
        `${semesterRoot}/lesson_progress/${uid}`,
      ] };
    });
    const receipts = enrollmentRows.length ? await getAll(enrollmentRows.flatMap(row => row.receiptPaths),
      ['studentUid', 'uid', 'semesterId', 'accountId', 'sourceId', 'type', 'delta', 'reclaimed', 'corePointRewardClaimed']) : [];
    for (const [index, item] of enrollmentRows.entries()) {
      const { enrollment, data, uid, row, accountId, ledgerEntryId } = item;
      const [ledger, legacy, progressRoot] = receipts.slice(index * 3, index * 3 + 3);
      if (ledger.exists || legacy.exists || progressRoot.data()?.corePointRewardClaimed === true) {
        rows.push({ ...row, status: 'ALREADY_SETTLED', evidence: { canonical: ledger.exists, legacy: legacy.exists,
          rootClaimed: progressRoot.data()?.corePointRewardClaimed === true } });
        continue;
      }
      const [slot, classroom, profile, account] = await getAll([
        `${contract.archive.ENROLLMENT_SLOT_COLLECTION}/${contract.archive.buildEnrollmentSlotId(semesterId, uid)}`,
        `${contract.archive.SEMESTER_CLASS_COLLECTION}/${data.classId}`, `users/${uid}`,
        `${contract.wis.WIS_ACCOUNT_COLLECTION}/${accountId}`,
      ], ['studentUid', 'semesterId', 'status', 'activeEnrollmentId', 'classId', 'readOnly', 'role', 'accountId', 'revision']);
      const activeId = contract.activeSlot({ slotSnapshot: slot, semesterId, uid });
      assert.equal(activeId, enrollment.id, 'Active enrollment pointer changed');
      assert(classroom.exists && classroom.data().classId === data.classId && classroom.data().semesterId === semesterId
        && classroom.data().status === 'ACTIVE' && !classroom.data().readOnly, 'Active classroom changed');
      if (!profile.exists || String(profile.data().role || 'student').trim() !== 'student'
        || !account.exists || account.data().accountId !== accountId || account.data().studentUid !== uid
        || account.data().semesterId !== semesterId || account.data().status !== 'ACTIVE' || account.data().readOnly) {
        rows.push({ ...row, status: 'REVIEW_ACCOUNT' });
        continue;
      }
      const completion = await contract.completion(catalogReader, year, semester, uid, data.classId);
      const evidence = { totalCount: completion.totalCount, foundCount: completion.foundCount, catalogHash: completion.catalogHash };
      if (!completion.complete) {
        rows.push({ ...row, status: 'INCOMPLETE', ...evidence });
        continue;
      }
      const [otherLedger, reclaims] = await Promise.all([
        readQuery(db.collection(contract.wis.WIS_LEDGER_COLLECTION).where('semesterId', '==', semesterId)
          .where('studentUid', '==', uid).where('sourceId', '==', 'lesson-core-points-all')
          .select('type', 'delta', 'sourceId', 'reversedLedgerEntryId')),
        readQuery(db.collection(`${semesterRoot}/point_transactions`).where('uid', '==', uid)
          .where('activityType', '==', 'lesson_core_points_reclaim').select('delta', 'sourceId', 'originalTransactionId')),
      ]);
      // Any payment/reversal/reclaim evidence needs manual review, never a
      // second grant merely because the modern deterministic receipt is absent.
      if (otherLedger.docs.length || reclaims.docs.length) {
        rows.push({ ...row, status: 'REVIEW_HISTORY', ...evidence });
        continue;
      }
      rows.push({ ...row, status: 'ELIGIBLE', accountId, ledgerEntryId, amount: 500,
        accountRevision: account.data().revision, ...evidence });
    }
    cursor = page.docs.length === 100 ? page.docs.at(-1) : null;
  } while (cursor);
  rows.sort((a, b) => a.uid.localeCompare(b.uid));
  const counts = Object.fromEntries(['ALREADY_SETTLED', 'REVIEW_ACCOUNT', 'INCOMPLETE', 'REVIEW_HISTORY', 'ELIGIBLE']
    .map(status => [status, rows.filter(row => row.status === status).length]));
  const plan = { schemaVersion: 1, mode: 'DRY_RUN', projectId, semesterId, sourceId: 'lesson-core-points-all',
    sourceHash: contract.sourceHash, semesterRevision: manifest.data().revision, counts,
    totalReward: counts.ELIGIBLE * 500, rows };
  return { ...plan, planHash: sha(canonical(plan)), checkedAt: new Date().toISOString(), reads, productionWrites: 0 };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const match = /^--(year|semester|plan|source-dir|expect-source)=(.+)$/.exec(arg);
    assert(match, 'Only read-only --year, --semester, --plan, --source-dir and --expect-source are supported');
    return [match[1], match[2]];
  }));
  assert(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Production audit cannot use emulator overrides');
  const planFile = path.resolve(args.plan || path.join(root, 'output/core-point-reward-20261123/repair-plan.json'));
  const permittedRoots = [path.join(root, 'output'), os.tmpdir()].map(value => path.resolve(value).toLowerCase() + path.sep);
  assert(permittedRoots.some(value => planFile.toLowerCase().startsWith(value)), 'Private plan must stay under output or TEMP');
  const { accessToken } = await import('./wispi-bonus-claim-release-cloud.mjs');
  const db = createReadOnlyRestDb({ projectId: 'history-quiz-yongsin', tokenProvider: accessToken });
  if (args['expect-source']) assert.equal((await loadRepairContract(db, args['source-dir'])).sourceHash, args['expect-source'], 'Source hash changed');
  const plan = await buildRepairPlan({ db, year: args.year, semester: args.semester, projectId: 'history-quiz-yongsin',
    sourceDirectory: args['source-dir'], documentId: '__name__' });
  await fs.mkdir(path.dirname(planFile), { recursive: true });
  await fs.writeFile(planFile, JSON.stringify(plan, null, 2), { flag: 'wx' });
  const { rows, ...summary } = plan;
  console.log(JSON.stringify({ ...summary, planFile }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
