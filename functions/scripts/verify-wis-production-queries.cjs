// Read-only production readiness: checks schema aggregates and query plans.
// No student identities or individual amounts are printed or persisted.
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const { resolveCredential } = require('./rebuild-wis-ranking-index.cjs');
const assert = require('node:assert/strict');
(async () => {
  const app = initializeApp({ projectId: 'history-quiz-yongsin', credential: await resolveCredential() }, 'wis-query-readiness');
  try {
    const db = getFirestore(app);
    const semesterId = (await db.doc('site_settings/semester_active').get()).data().semesterId;
    const accounts = await db.collection('semester_wis_accounts').where('semesterId', '==', semesterId)
      .select('grade', 'classNumber', 'studentNumber', 'displayName', 'balance', 'earnedTotal', 'rankEarnedTotal', 'spentTotal').limit(2001).get();
    assert.ok(accounts.size <= 2000, 'Account schema audit safety bound exceeded');
    const schemaIssues = {};
    for (const doc of accounts.docs) {
      const value = doc.data();
      for (const field of ['grade', 'classNumber', 'studentNumber']) {
        if (typeof value[field] !== 'string' || !/^[1-9]\d{0,2}$/.test(value[field])) schemaIssues[field] = (schemaIssues[field] || 0) + 1;
      }
      for (const field of ['balance', 'earnedTotal', 'rankEarnedTotal', 'spentTotal']) {
        if (!Number.isSafeInteger(value[field]) || value[field] < 0) schemaIssues[field] = (schemaIssues[field] || 0) + 1;
      }
      if (typeof value.displayName !== 'string' || !value.displayName.trim()) schemaIssues.displayName = (schemaIssues.displayName || 0) + 1;
    }
    const scopes = [{}, { grade: '3' }, { grade: '3', classNumber: '2' }, { grade: '3', classNumber: '2', studentNumber: '1' }];
    const plans = [];
    for (const filters of scopes) {
      let base = db.collection('semester_wis_accounts').where('semesterId', '==', semesterId);
      for (const [key, value] of Object.entries(filters)) base = base.where(key, '==', value);
      for (const field of ['balance', 'earnedTotal', 'rankEarnedTotal', 'spentTotal']) for (const direction of ['asc', 'desc']) {
        try {
          const result = await base.orderBy(field, direction).orderBy(FieldPath.documentId(), 'asc').limit(21).explain({ analyze: false });
          plans.push({ filters: Object.keys(filters), field, direction, ready: true, indexCount: result.metrics.planSummary.indexesUsed.length });
        } catch (error) { plans.push({ filters: Object.keys(filters), field, direction, ready: false, code: error.code }); }
      }
      try {
        const result = await base.where('displayName', '>=', '가').where('displayName', '<=', '가\uf8ff')
          .orderBy('displayName', 'asc').orderBy(FieldPath.documentId(), 'asc').limit(21).explain({ analyze: false });
        plans.push({ filters: Object.keys(filters), field: 'displayName', ready: true, indexCount: result.metrics.planSummary.indexesUsed.length });
      } catch (error) { plans.push({ filters: Object.keys(filters), field: 'displayName', ready: false, code: error.code }); }
    }
    const result = { mode: 'read-only', semesterId, accounts: accounts.size, schemaIssues,
      plans, readyPlans: plans.filter(plan => plan.ready).length, writes: 0 };
    console.log(JSON.stringify(result, null, 2));
    if (Object.keys(schemaIssues).length || plans.some(plan => !plan.ready)) process.exitCode = 2;
  } finally { await deleteApp(app); }
})().catch(() => { console.error('Read-only Wis query readiness failed; no writes made.'); process.exitCode = 1; });
