const { HttpsError } = require('firebase-functions/v2/https');
const { createHash } = require('node:crypto');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');
const { evaluateStudentMaintenanceAccess, DEFAULT_DISABLED_CONFIG } = require('./studentMaintenance');
const { normalizeWisStockInvestmentBoardScope, parseWisStockInvestmentBoardSnapshot,
  parseWisStockInvestmentBoardSession } = require('./wisStockInvestmentBoard');
const { readMarket } = require('./wisStocks');
const { accountIdFor } = require('./studentWisWallet');
const { buildWisStockInvestmentHistorySeries } = require('./wisStockInvestmentHistorySeries.mjs');
const ADMIN_EMAIL = 'westoria28@gmail.com';
const fail = (reason, message = '학생 수익률 이력을 확인하지 못했습니다. 다시 조회해 주세요.', code = 'failed-precondition') => {
  throw new HttpsError(code, message, { reason });
};

function createWisStockInvestmentHistory({ db, now = Date.now, assertSession = assertScoreWorkflowSession }) {
  return async request => {
    const authority = await assertSession(request), input = request.data;
    const batch = Array.isArray(input?.studentKeys);
    const studentKeys = batch ? input.studentKeys : [input?.studentKey];
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['year', 'semester', 'grade', 'classNumber', 'studentKey', 'studentKeys', '_session'].includes(key))
      || (batch && Object.hasOwn(input, 'studentKey')) || (!batch && Object.hasOwn(input, 'studentKeys'))
      || studentKeys.length < 1 || studentKeys.length > 5 || new Set(studentKeys).size !== studentKeys.length
      || studentKeys.some(key => typeof key !== 'string' || !/^student_[a-f0-9]{24}$/.test(key)))
      fail('WIS_STOCK_INPUT_INVALID', undefined, 'invalid-argument');
    let scope;
    try { scope = normalizeWisStockInvestmentBoardScope(input); } catch { fail('WIS_STOCK_INPUT_INVALID', undefined, 'invalid-argument'); }
    const uid = request.auth?.uid, authTime = request.auth?.token?.auth_time;
    if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) || authority?.uid !== uid
      || !Number.isSafeInteger(authTime) || authTime < 1) fail('WIS_STOCK_SESSION_INVALID', undefined, 'unauthenticated');
    const root = `years/${scope.year}/semesters/${scope.semester}`;
    return db.runTransaction(async tx => {
      const profileSnap = await tx.get(db.doc(`users/${uid}`));
      const profile = profileSnap.data() || {}, email = String(request.auth?.token?.email || '').trim().toLowerCase();
      const permissions = profile.teacherPortalEnabled === true && Array.isArray(profile.staffPermissions) ? profile.staffPermissions : [];
      if (!profileSnap.exists || profile.disabled || profile.deletedAt || profile.isDeleted || profile.weplayDeletionPending
        || (email !== ADMIN_EMAIL && (profile.registrationApprovalStatus ?? 'APPROVED') !== 'APPROVED')
        || (email !== ADMIN_EMAIL && profile.role !== 'teacher'
          && (profile.role !== 'staff' || !permissions.some(value => value === 'point_read' || value === 'point_manage'))))
        fail('WIS_STOCK_TEACHER_REQUIRED', '학생 투자 현황을 볼 권한이 없습니다.', 'permission-denied');
      const paths = ['site_settings/config', 'site_settings/semester_active', `semester_manifests/${scope.semesterId}`,
        `${root}/wis_stock_investment_boards/${scope.documentId}`, `${root}/wis_stock_markets/current`,
        `application_sessions/${uid}/sessions/${authTime}`, 'site_settings/student_maintenance'];
      const [configSnap, pointerSnap, manifestSnap, boardSnap, marketSnap, sessionSnap, maintenanceSnap]
        = await tx.getAll(...paths.map(path => db.doc(path)));
      const asOfMs = now();
      let session;
      try { session = parseWisStockInvestmentBoardSession(sessionSnap.data(), { uid, authTime }, asOfMs); }
      catch { fail('WIS_STOCK_SESSION_INVALID', undefined, 'unauthenticated'); }
      if (session.revision !== input._session?.revision || !evaluateStudentMaintenanceAccess({ auth: request.auth,
        config: maintenanceSnap.exists ? maintenanceSnap.data() : DEFAULT_DISABLED_CONFIG, profile, profileExists: true }).allowed)
        fail('WIS_STOCK_SESSION_INVALID', undefined, 'unauthenticated');
      const config = configSnap.data() || {}, pointer = pointerSnap.data() || {}, manifest = manifestSnap.data() || {};
      if (String(config.year) !== scope.year || String(config.semester) !== scope.semester || pointer.semesterId !== scope.semesterId
        || manifest.semesterId !== scope.semesterId || manifest.status !== 'ACTIVE' || manifest.readOnly === true
        || !Number.isSafeInteger(pointer.revision) || pointer.revision < 1 || manifest.revision !== pointer.revision)
        fail('WIS_STOCK_SCOPE_CHANGED', '현재 학기에서 다시 조회해 주세요.');
      const board = parseWisStockInvestmentBoardSnapshot(boardSnap.exists ? boardSnap.data() : null, scope);
      const histories = [];
      // Authority, semester, scoped board and prices are read once for up to
      // five displayed students. Each ledger query remains account-scoped.
      const market = readMarket(marketSnap, scope);
      for (const studentKey of studentKeys) {
        const selected = board.rows.find(row => row.studentKey === studentKey);
        if (!selected) fail('WIS_STOCK_INVESTMENT_STUDENT_UNAVAILABLE', '선택한 범위에서 학생의 투자 현황을 찾을 수 없습니다.', 'not-found');
        const accounts = await tx.get(db.collection(`${root}/wis_stock_accounts`).where('studentKey', '==', studentKey)
          .select('schemaVersion', 'semesterId', 'accountId', 'studentKey', 'studentUid', 'grade', 'classNumber', 'boardEligible', 'revision', 'positions').limit(2));
        if (accounts.size !== 1) fail('WIS_STOCK_INVESTMENT_HISTORY_INVALID');
        const account = accounts.docs[0].data();
        if (account.schemaVersion !== 1 || account.semesterId !== scope.semesterId || account.studentKey !== studentKey
          || account.boardEligible === false || account.grade !== selected.grade || account.classNumber !== selected.classNumber
          || typeof account.studentUid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(account.studentUid)
          || account.accountId !== accountIdFor(scope.semesterId, account.studentUid) || account.accountId !== accounts.docs[0].id
          || account.studentKey !== `student_${createHash('sha256').update(account.studentUid).digest('hex').slice(0, 24)}`)
          fail('WIS_STOCK_INVESTMENT_HISTORY_INVALID');
        // Equality filters use Firestore's existing single-field index merge.
        // Read every filled trade for this one account; never truncate analysis.
        const entries = await tx.get(db.collection(`${root}/wis_stock_history`).where('accountId', '==', account.accountId)
          .where('kind', '==', 'ORDER_FILLED').select('accountId', 'studentUid', 'semesterId', 'kind', 'sequence', 'atMs',
            'stockId', 'side', 'quantity', 'unitPrice', 'fee', 'stockCashDelta', 'realizedPnl'));
        const fills = entries.docs.map(doc => {
          const row = doc.data();
          if (row.accountId !== account.accountId || row.studentUid !== account.studentUid || row.semesterId !== scope.semesterId
            || row.kind !== 'ORDER_FILLED') fail('WIS_STOCK_INVESTMENT_HISTORY_INVALID');
          return row;
        });
        let series;
        try { series = buildWisStockInvestmentHistorySeries({ account, fills, stocks: market.stocks, asOfMs }); }
        catch (error) { fail(error.reason || 'WIS_STOCK_INVESTMENT_HISTORY_INVALID', error.message); }
        histories.push({ semesterId: scope.semesterId, studentKey: studentKey, grade: selected.grade, classNumber: selected.classNumber,
          asOfMs, sourceRevision: account.revision, priceRevision: market.revision, ...series });
      }
      return batch ? { semesterId: scope.semesterId, histories } : histories[0];
    }, { readOnly: true });
  };
}
module.exports = { createWisStockInvestmentHistory };
