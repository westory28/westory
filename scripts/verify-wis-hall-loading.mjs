/** Run the actual parent pages' hooks/effects with deferred network boundaries. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policy = { rankPolicy: { enabled: true, activeThemeId: 'korean_golpum', tiers: [], themes: {}, emojiRegistry: [] },
  manualAdjustEnabled: true, allowNegativeBalance: false };
const wallet = uid => ({ uid, studentName: uid, grade: '3', class: '1', number: '1', balance: 100,
  earnedTotal: 200, rankEarnedTotal: 200, spentTotal: 0, adjustedTotal: 0, rankSnapshot: null });
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
    esModuleInterop: true },
}).outputText;
const actualLabels = (() => {
  const exports = {};
  vm.runInNewContext(compile('src/constants/pointLabels.ts'), { exports });
  return exports;
})();
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const moduleDefault = value => ({ __esModule: true, default: value });

const createPage = (audience, { tab = 'hall-of-fame', ready = true, archive = false } = {}) => {
  const slots = [], listeners = new Set(), calls = [], logs = [];
  let cursor = 0, effects = [], dirty = true, tree;
  let params = new URLSearchParams(tab === 'overview' ? '' : `tab=${tab}`);
  const auth = { config: { year: '2026', semester: '2' }, configReady: ready, authGeneration: 1,
    currentUser: { uid: `${audience}-a`, email: `${audience}@example.invalid` },
    userData: { uid: `${audience}-a`, role: audience, grade: '3', class: '1', staffPermissions: ['point_read', 'point_manage'] },
    interfaceConfig: {}, refreshInterfaceConfig: async () => {} };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, next => {
        const value = typeof next === 'function' ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return (slots[index] ||= { current: initial }); },
    useMemo(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { value: callback(), deps };
      return slots[index].value;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) {
        const previous = slots[index];
        slots[index] = { deps, cleanup: previous?.cleanup };
        effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = callback(); });
      }
    },
  };
  const flush = () => {
    let renders = 0;
    while (dirty || effects.length) {
      assert(++renders < 100, 'Page effects must settle without an infinite render/read loop');
      if (dirty) { dirty = false; cursor = 0; tree = Page(); }
      const next = effects; effects = []; next.forEach(callback => callback());
    }
  };
  const tick = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); flush(); } };
  const responseFor = call => {
    if (call.name === 'hall') return { snapshotKey: `${call.uid}:${call.scope.year}-${call.scope.semester}:${calls.indexOf(call)}` };
    if (call.name === 'wallet') return wallet(call.uid);
    if (call.name === 'wallets') return [wallet(`student-for-${call.uid}-${call.scope.semester}`)];
    if (call.name === 'policy') return structuredClone(policy);
    if (call.name === 'schoolOptions') return { grades: [{ value: '3', label: '3학년' }], classes: [{ value: '1', label: '1반' }] };
    if (call.name === 'legacyMap') return {};
    if (call.name === 'legacyPoints') return 0;
    return [];
  };
  const request = name => (scope = auth.config, ...args) => new Promise((resolve, reject) => {
    const call = { name, scope: { year: scope?.year, semester: scope?.semester }, args,
      uid: auth.currentUser?.uid, settled: false };
    calls.push(call);
    call.resolve = (value = responseFor(call)) => { call.settled = true; resolve(value); };
    call.reject = () => { call.settled = true; reject(new Error(`Synthetic ${name} failure`)); };
  });
  const points = {
    POINT_POLICY_FALLBACK: policy, getPointPolicy: request('policy'), listPointWallets: request('wallets'),
    getPointSchoolOptions: request('schoolOptions'), listPointOrders: request('orders'), listPointProducts: request('products'),
    listPointTransactionsByUid: request('transactions'), getPointRankManualAdjustEarnedPointsMap: request('legacyMap'),
    getPointRankManualAdjustEarnedPointsByUid: request('legacyPoints'), listPointStudentTargets: request('targets'),
    listPointStudentTargetsByClass: request('classTargets'),
  };
  const rankHelpers = {
    needsPointRankLegacyFallback: () => false, getPointRankDisplay: () => ({ label: '검증 등급' }),
    resolvePointRankPolicyDraft: value => ({ ...policy.rankPolicy, ...value }),
    getPointWalletCumulativeEarned: value => value.rankEarnedTotal,
  };
  const children = ['StudentPointHallOfFameTab', 'StudentPointOrdersTab', 'StudentPointShopTab', 'StudentPointSummaryTab',
    'PointGrantTab', 'PointPolicyTab', 'PointRanksTab', 'PointProductsTab', 'PointRequestsTab', 'PointsOverviewTab', 'HallOfFameManagementTab'];
  const require = name => {
    if (name === 'react') return { __esModule: true, default: React, ...React };
    if (name === 'react-router-dom') return { useSearchParams: () => [params, next => {
      params = next instanceof URLSearchParams ? next : new URLSearchParams(next); dirty = true;
    }] };
    if (name.endsWith('/AuthContext')) return { useAuth: () => auth };
    if (name.endsWith('/pointLabels')) return actualLabels;
    if (name.endsWith('/points')) return points;
    if (name.endsWith('/studentWis')) return {
      getStudentPointWallet: request('wallet'), listStudentPointOrders: request('orders'),
      listStudentPointProducts: request('products'), listStudentPointTransactions: request('transactions'),
      getStudentPointHallOfFame: request('hall'),
    };
    if (name.endsWith('/pointRanks')) return rankHelpers;
    if (name.endsWith('/pointEconomyAdapter')) return { getPendingCanonicalPointAdjustment: () => null };
    if (name.endsWith('/wisHallOfFame')) return { findWisHallOfFameEntryByUid: () => null };
    if (name.endsWith('/permissions')) return { canReadPoints: data => data.staffPermissions?.includes('point_read'), canManagePoints: () => true };
    if (name.endsWith('/semesterArchive')) return { isSemesterArchive: archive };
    if (name.endsWith('/semesterScope')) return { getYearSemester: config => config };
    if (name.endsWith('/pointShopArchive')) return { readArchivedShopProducts: request('archiveProducts'), readArchivedShopOrders: request('archiveOrders') };
    if (name.endsWith('/appEvents')) return { subscribePointsUpdated: callback => { listeners.add(callback); return () => listeners.delete(callback); } };
    if (name.endsWith('/AppToastProvider')) return { useAppToast: () => ({ showToast: () => {} }) };
    if (name.endsWith('/AppDialogProvider')) return { useAppDialog: () => ({ confirm: async () => false }) };
    if (name.endsWith('/LoadingState')) return { InlineLoading: 'InlineLoading' };
    const child = children.find(child => name.endsWith(`/${child}`));
    if (child) return moduleDefault(child);
    if (name === 'firebase/storage' || ['/firebase', '/sensitiveOperation', '/pointProductImages'].some(suffix => name.endsWith(suffix))) return {};
    throw new Error(`Unexpected page dependency: ${name}`);
  };
  const exports = {};
  vm.runInNewContext(compile(audience === 'student' ? 'src/pages/student/Points.tsx' : 'src/pages/teacher/ManagePoints.tsx'),
    { exports, require, URLSearchParams, URL, performance, console: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) } });
  const Page = exports.default;
  const nodes = (type, node = tree) => {
    if (!node || typeof node !== 'object') return [];
    const children = Array.isArray(node) ? node : node.props?.children || [];
    return [...(node.type === type ? [node] : []), ...children.flatMap(child => nodes(type, child))];
  };
  const texts = (node = tree) => {
    if (typeof node === 'string') return node;
    if (!node || typeof node !== 'object') return '';
    return (Array.isArray(node) ? node : node.props?.children || []).map(texts).join(' ');
  };
  const navigate = tab => { params = new URLSearchParams(tab === 'overview' ? '' : `tab=${tab}`); dirty = true; flush(); };
  const update = change => { change(auth); dirty = true; flush(); };
  const pending = name => calls.filter(call => !call.settled && (!name || call.name === name));
  const resolveAll = async () => {
    for (let i = 0; i < 10; i++) { pending().forEach(call => call.resolve()); await tick(); if (!pending().length) return; }
    throw new Error('Unexpected automatic reads after settling');
  };
  flush();
  return { auth, calls, logs, nodes, texts, tick, flush, navigate, update, pending, resolveAll,
    event: () => { [...listeners].forEach(callback => callback()); flush(); },
    dispose: () => slots.forEach(slot => slot?.cleanup?.()),
  };
};

const checks = [];
const check = async (name, run) => { await run(); checks.push(name); };
const names = page => page.calls.map(call => call.name);
await check('student direct Hall waits only for its own scope and sends no wallet/history/policy/shop/order reads', async () => {
  const page = createPage('student', { ready: false });
  assert.equal(page.calls.length, 0);
  page.update(auth => { auth.configReady = true; });
  assert.deepEqual(names(page), ['hall']); assert.equal(page.nodes('InlineLoading').length, 1);
  page.pending('hall')[0].resolve(); await page.tick();
  assert.equal(page.nodes('StudentPointHallOfFameTab').length, 1);
  assert.equal(page.nodes('InlineLoading').length, 0);
  assert.equal(typeof page.nodes('main')[0].props['data-hall-load-ms'], 'number');
  page.dispose();
});
await check('student Hall config object replacement does not refetch and points events refresh only Hall', async () => {
  const page = createPage('student'); await page.resolveAll();
  page.update(auth => { auth.config = { ...auth.config, unrelated: true }; });
  assert.deepEqual(names(page), ['hall']);
  page.event(); assert.deepEqual(names(page), ['hall', 'hall']);
  await page.resolveAll(); page.dispose();
});
await check('student direct Hall uses canonical grade/class map keys without wallet or profile placement reads', async () => {
  for (const fixture of [
    { userGrade: '', userClass: '', gradeKey: '2', classKey: '2-4', expectedGrade: '2', expectedClass: '4' },
    { userGrade: '3', userClass: '1', gradeKey: '2', classKey: '2-7', expectedGrade: '2', expectedClass: '7' },
    { userGrade: '', userClass: '', gradeKey: '03학년', classKey: '03학년-04반', expectedGrade: '3', expectedClass: '4' },
  ]) {
    const page = createPage('student');
    page.update(auth => { auth.userData = { ...auth.userData, grade: fixture.userGrade, class: fixture.userClass }; });
    page.pending('hall')[0].resolve({ gradeLeaderboardByGrade: { [fixture.gradeKey]: [] },
      classLeaderboardByClassKey: { [fixture.classKey]: [] } }); await page.tick();
    const props = page.nodes('StudentPointHallOfFameTab')[0].props;
    assert.equal(props.currentGrade, fixture.expectedGrade); assert.equal(props.currentClass, fixture.expectedClass);
    assert.deepEqual(names(page), ['hall']); page.dispose();
  }
});
await check('student overview first visit loads core while Hall can render before that core settles', async () => {
  const page = createPage('student'); await page.resolveAll();
  page.navigate('overview');
  assert.deepEqual(names(page), ['hall', 'wallet', 'transactions', 'policy']);
  page.navigate('hall-of-fame'); assert.equal(page.pending('hall').length, 1);
  page.pending('hall')[0].resolve(); await page.tick();
  assert.equal(page.pending().length, 3); assert.equal(page.nodes('StudentPointHallOfFameTab').length, 1);
  assert.equal(page.nodes('InlineLoading').length, 0);
  await page.resolveAll(); page.navigate('overview');
  assert.equal(page.nodes('StudentPointSummaryTab').length, 1); assert.equal(page.pending().length, 0);
  page.event();
  assert.equal(page.pending('wallet').length, 1); assert.equal(page.pending('transactions').length, 0);
  assert.equal(page.pending('policy').length, 1); assert.equal(page.pending('hall').length, 0);
  page.pending('wallet')[0].resolve(); page.pending('policy')[0].resolve(); await page.tick();
  assert.equal(page.pending('transactions').length, 1, 'History refresh is read once after core completion');
  await page.resolveAll(); page.dispose();
});
await check('student shop and orders retain first-visit reads after direct Hall entry', async () => {
  const page = createPage('student'); await page.resolveAll();
  page.navigate('shop');
  assert.equal(page.pending('wallet').length, 1); assert.equal(page.pending('products').length, 1);
  assert.equal(page.pending('orders').length, 0); await page.resolveAll();
  assert.equal(page.nodes('StudentPointShopTab').length, 1);
  page.navigate('orders'); assert.equal(page.pending('orders').length, 1);
  assert.equal(page.pending('wallet').length, 0); await page.resolveAll();
  assert.equal(page.nodes('StudentPointOrdersTab').length, 1); page.dispose();
});
await check('student Hall error ends loading, does not poll, and permits an explicit retry', async () => {
  const page = createPage('student'); page.pending('hall')[0].reject(); await page.tick();
  assert.equal(page.nodes('InlineLoading').length, 0); assert.match(page.texts(), /명예의 전당을 불러오지 못했습니다/);
  assert.equal(page.calls.length, 1);
  const retry = page.nodes('button').find(node => page.texts(node).includes('다시 불러오기'));
  assert(retry); retry.props.onClick(); await page.tick();
  assert.deepEqual(names(page), ['hall', 'hall']); await page.resolveAll();
  assert.equal(page.nodes('StudentPointHallOfFameTab').length, 1); page.dispose();
});
await check('student failed background core data never hides an independently accepted Hall response', async () => {
  const page = createPage('student', { tab: 'overview' });
  page.navigate('hall-of-fame');
  page.pending('policy')[0].reject(); await page.tick();
  assert.equal(page.pending('hall').length, 1);
  page.pending('hall')[0].resolve(); await page.tick();
  assert.equal(page.nodes('StudentPointHallOfFameTab').length, 1);
  assert.equal(page.nodes('InlineLoading').length, 0);
  assert.doesNotMatch(page.texts(), /위스 정보를 불러오지 못했습니다/);
  await page.resolveAll(); page.dispose();
});
await check('student account and semester changes reject late Hall responses and clear visible old data immediately', async () => {
  const page = createPage('student'), old = page.pending('hall')[0];
  page.update(auth => { auth.currentUser = { uid: 'student-b' }; auth.authGeneration++; auth.config = { ...auth.config, semester: '1' }; });
  assert.equal(page.calls.length, 2); const fresh = page.pending('hall')[1];
  fresh.resolve({ snapshotKey: 'accepted-b-new-semester' }); await page.tick();
  old.resolve({ snapshotKey: 'forbidden-a-old-semester' }); await page.tick();
  assert.equal(page.nodes('StudentPointHallOfFameTab')[0].props.snapshot.snapshotKey, 'accepted-b-new-semester');
  page.update(auth => { auth.currentUser = { ...auth.currentUser }; });
  assert.equal(page.nodes('StudentPointHallOfFameTab').length, 0);
  assert.equal(page.calls.length, 3); await page.resolveAll();
  page.update(auth => { auth.currentUser = null; auth.authGeneration++; });
  assert.equal(page.nodes('StudentPointHallOfFameTab').length, 0); assert.equal(page.calls.length, 3); page.dispose();
});
await check('student old core responses cannot populate the next account or suppress its deferred core load', async () => {
  const page = createPage('student', { tab: 'overview' }), old = [...page.pending()];
  page.navigate('hall-of-fame');
  page.update(auth => { auth.currentUser = { uid: 'student-b' }; auth.authGeneration++; });
  old.forEach(call => call.resolve()); await page.tick();
  page.navigate('overview');
  assert.equal(page.pending('wallet').filter(call => call.uid === 'student-b').length, 1);
  await page.resolveAll();
  assert.equal(page.nodes('StudentPointSummaryTab')[0].props.wallet.uid, 'student-b'); page.dispose();
});
await check('student old shop and order responses cannot clear a new scope loader or expose former account data', async () => {
  const page = createPage('student', { tab: 'shop' }), old = [...page.pending()];
  page.update(auth => { auth.currentUser = { uid: 'student-b' }; auth.authGeneration++; });
  old.forEach(call => call.resolve(call.name === 'products' ? [{ id: 'forbidden-old-product' }] : undefined));
  await page.tick();
  page.pending().filter(call => call.name !== 'products').forEach(call => call.resolve()); await page.tick();
  assert.equal(page.nodes('StudentPointShopTab').length, 0, 'Old completion cannot stop the new shop loader');
  page.pending('products')[0].resolve([{ id: 'accepted-new-product' }]); await page.tick();
  assert.equal(page.nodes('StudentPointShopTab')[0].props.products[0].id, 'accepted-new-product');
  page.navigate('orders'); const oldOrders = page.pending('orders')[0];
  page.update(auth => { auth.config = { ...auth.config, semester: '1' }; });
  const freshOrders = page.pending('orders').find(call => call !== oldOrders);
  freshOrders.resolve([{ id: 'accepted-new-order' }]); oldOrders.resolve([{ id: 'forbidden-old-order' }]);
  await page.resolveAll();
  assert.equal(page.nodes('StudentPointOrdersTab')[0].props.orders[0].id, 'accepted-new-order'); page.dispose();
});
await check('teacher direct Hall mounts immediately with no parent collection reads or loading gate', async () => {
  const page = createPage('teacher');
  assert.equal(page.calls.length, 0); assert.equal(page.nodes('HallOfFameManagementTab').length, 1);
  assert.equal(page.nodes('InlineLoading').length, 0);
  const previousKey = page.nodes('HallOfFameManagementTab')[0].props.key;
  const previousRefreshKey = page.nodes('HallOfFameManagementTab')[0].props.refreshKey;
  page.event();
  assert.equal(page.nodes('HallOfFameManagementTab')[0].props.key, previousKey, 'Point refresh must preserve unsaved editor drafts');
  assert.notEqual(page.nodes('HallOfFameManagementTab')[0].props.refreshKey, previousRefreshKey);
  assert.equal(page.calls.length, 0); page.dispose();
});
await check('teacher other-tab first visits retain all existing data and Hall ignores a pending loadAll', async () => {
  const page = createPage('teacher'); page.navigate('overview');
  assert.deepEqual(names(page), ['wallets', 'schoolOptions', 'policy', 'products', 'orders']);
  page.navigate('hall-of-fame');
  assert.equal(page.nodes('HallOfFameManagementTab').length, 1); assert.equal(page.nodes('InlineLoading').length, 0);
  await page.resolveAll();
  assert.equal(page.calls.length, 5, 'Hall must not start selected-student transaction reads');
  page.navigate('overview'); await page.resolveAll();
  assert.equal(page.nodes('PointsOverviewTab').length, 1); assert.equal(page.calls.filter(call => call.name === 'wallets').length, 1);
  page.navigate('products'); assert.equal(page.nodes('PointProductsTab').length, 1);
  page.navigate('requests'); assert.equal(page.nodes('PointRequestsTab').length, 1); page.dispose();
});
await check('teacher scope and SDK identity changes remount Hall and reject old core results', async () => {
  const page = createPage('teacher', { tab: 'overview' }), old = [...page.pending()];
  page.navigate('hall-of-fame'); const previousKey = page.nodes('HallOfFameManagementTab')[0].props.key;
  page.update(auth => { auth.currentUser = { uid: 'teacher-b' }; auth.authGeneration++; auth.config = { ...auth.config, semester: '1' }; });
  assert.notEqual(page.nodes('HallOfFameManagementTab')[0].props.key, previousKey);
  old.forEach(call => call.resolve()); await page.tick();
  assert.equal(page.calls.length, 5); page.navigate('overview');
  assert.equal(page.pending('wallets').filter(call => call.uid === 'teacher-b' && call.scope.semester === '1').length, 1);
  await page.resolveAll();
  assert.match(page.nodes('PointsOverviewTab')[0].props.wallets[0].uid, /teacher-b-1/);
  page.navigate('hall-of-fame'); const sdkKey = page.nodes('HallOfFameManagementTab')[0].props.key;
  page.update(auth => { auth.currentUser = { ...auth.currentUser }; });
  assert.notEqual(page.nodes('HallOfFameManagementTab')[0].props.key, sdkKey);
  const count = page.calls.length; page.update(auth => { auth.currentUser = null; auth.authGeneration++; });
  assert.equal(page.nodes('HallOfFameManagementTab').length, 0); assert.equal(page.calls.length, count); page.dispose();
});
await check('teacher scope readiness and permissions protect direct Hall before any request', async () => {
  const page = createPage('teacher', { ready: false });
  assert.equal(page.nodes('HallOfFameManagementTab').length, 0); assert.equal(page.calls.length, 0);
  page.update(auth => { auth.configReady = true; auth.userData = { ...auth.userData, staffPermissions: [] }; });
  assert.equal(page.nodes('HallOfFameManagementTab').length, 0); assert.equal(page.calls.length, 0); page.dispose();
});
await check('teacher unsupported prototype-like tab URLs retain the overview fallback', async () => {
  const page = createPage('teacher', { tab: 'toString' });
  assert.equal(page.pending('wallets').length, 1); await page.resolveAll();
  assert.equal(page.nodes('PointsOverviewTab').length, 1);
  assert.equal(page.nodes('HallOfFameManagementTab').length, 0); page.dispose();
});
await check('teacher unrelated config and point events do not reload other editor drafts; active Hall refreshes independently', async () => {
  const page = createPage('teacher', { tab: 'overview' }); await page.resolveAll();
  const count = page.calls.length;
  page.update(auth => { auth.config = { ...auth.config, unrelated: true }; });
  assert.equal(page.calls.length, count);
  page.event(); assert.equal(page.calls.length, count);
  page.navigate('hall-of-fame'); const before = page.calls.length; page.event();
  assert.equal(page.calls.length, before); assert.equal(page.nodes('HallOfFameManagementTab').length, 1); page.dispose();
});
await check('teacher archive shop tab retains its explicit isolated adapter and Hall skips all shop reads', async () => {
  const page = createPage('teacher', { archive: true }); assert.equal(page.calls.length, 0);
  page.navigate('products'); assert.deepEqual(names(page), ['archiveProducts']); await page.resolveAll();
  page.navigate('requests'); assert.deepEqual(names(page), ['archiveProducts', 'archiveOrders']); await page.resolveAll();
  page.navigate('hall-of-fame'); assert.equal(page.calls.length, 2); assert.equal(page.nodes('HallOfFameManagementTab').length, 1); page.dispose();
});
for (const file of ['src/pages/student/Points.tsx', 'src/pages/teacher/ManagePoints.tsx']) {
  assert.equal(/setInterval|setTimeout/.test(fs.readFileSync(path.join(root, file), 'utf8')), false, 'No polling or timer-based retry');
}
console.log(JSON.stringify({ status: 'PASS', network: 0, checks,
  scope: 'Actual parent page hooks/effects; deferred API boundaries and child component contracts. Child Hall rendering/browser layout is verified separately.' }, null, 2));
