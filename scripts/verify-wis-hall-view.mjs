/** Actual teacher Hall hooks, deferred scoped reads, and real config helpers. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFile = 'src/pages/teacher/components/points/HallOfFameManagementTab.tsx';
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const defaultModule = value => ({ __esModule: true, default: value });
const helpers = { exports: {} };
vm.runInNewContext(compile('src/lib/wisHallOfFame.ts'), { exports: helpers.exports, URL, URLSearchParams,
  require: name => {
    if (name.endsWith('.webp')) return defaultModule('/synthetic-podium.webp');
    if (name === './semesterScope') return { getYearSemester: value => value };
    if (['firebase/firestore', './firebase', './safeStorage'].includes(name)) return {};
    throw new Error(`Unexpected pure Hall helper dependency ${name}`);
  } });
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const makeSnapshot = call => {
  const grade = call.selection.view === 'class' ? call.selection.classKey.split('-')[0] : call.selection.gradeKey || '1';
  const classKey = call.selection.classKey || `${grade}-1`;
  const gradeMaps = { '1': [], '2': [] }, classMaps = { '1-1': [], '1-2': [], '2-1': [] };
  const rows = [{ uid: `${call.uid}:${call.scope.semester}:${call.selection.view}:${grade}:${classKey}`, studentName: '합성 학생',
    grade, class: classKey.split('-')[1], rank: 1, cumulativeEarned: 100 }];
  if (call.selection.view === 'grade') gradeMaps[grade] = rows; else classMaps[classKey] = rows;
  return { year: call.scope.year, semester: call.scope.semester, primaryGradeKey: grade,
    snapshotKey: rows[0].uid, gradeLeaderboardByGrade: gradeMaps, gradeTop3ByGrade: structuredClone(gradeMaps),
    classLeaderboardByClassKey: classMaps, classTop3ByClassKey: structuredClone(classMaps) };
};
const fixture = () => {
  const calls = [], saves = [], toasts = [], slots = [];
  const auth = { currentUser: { uid: 'teacher-a' }, authGeneration: 1 };
  let props = { config: { year: '2026', semester: '2' }, canManage: true, refreshKey: 0 };
  let cursor = 0, effects = [], dirty = true, tree, disposed = false;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, next => {
        if (disposed) return;
        const value = typeof next === 'function' ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useMemo(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { value: callback(), deps };
      return slots[index].value;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) {
        const previous = slots[index]; slots[index] = { deps, cleanup: previous?.cleanup };
        effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = callback(); });
      }
    },
  };
  const request = (config, audience, selection) => new Promise((resolve, reject) => {
    assert.equal(audience, 'teacher');
    assert(['grade', 'class'].includes(selection.view));
    const call = { scope: { ...config }, uid: auth.currentUser?.uid, selection: { ...selection }, settled: false };
    calls.push(call);
    call.resolve = (value = makeSnapshot(call)) => { call.settled = true; resolve(value); };
    call.reject = () => { call.settled = true; reject(new Error('Synthetic scoped read failure')); };
  });
  const exports = {};
  vm.runInNewContext(compile(sourceFile), { exports, URL, URLSearchParams, performance,
    console: { warn() {} }, require: name => {
      if (name === 'react') return { __esModule: true, default: React, ...React };
      if (name.endsWith('/wisHallOfFame')) return helpers.exports;
      if (name.endsWith('/wisRankingPreview')) return { getWisHallOfFameView: request };
      if (name.endsWith('/pointEconomyAdapter')) return {
        saveCanonicalWisHallOfFameConfig: (config, hallOfFame) => new Promise(resolve => {
          saves.push({ config, hallOfFame, resolve: () => resolve({ hallOfFame }) });
        }),
        getCanonicalWisHallOfFame: () => { throw new Error('A full Hall query is forbidden in view loading'); },
      };
      if (name.endsWith('/AuthContext')) return { useAuth: () => auth };
      if (name.endsWith('/AppToastProvider')) return { useAppToast: () => ({ showToast: toast => toasts.push(toast) }) };
      if (name.endsWith('/pointFormatters')) return { formatPointDateShortTime: () => '합성 시각' };
      if (name.endsWith('/siteSettings')) return { invalidateSiteSettingDocCache() {} };
      if (name.endsWith('/NumericInput')) return defaultModule('NumericInput');
      if (name.endsWith('/WisHallOfFameStudentPreview')) return defaultModule('WisHallOfFameStudentPreview');
      if (name.endsWith('/WisHallOfFamePositionEditor')) return defaultModule('WisHallOfFamePositionEditor');
      if (name === 'firebase/storage' || name.endsWith('/firebase') || name.endsWith('/sensitiveOperation')) return {};
      throw new Error(`Unexpected teacher Hall dependency ${name}`);
    } });
  const Component = exports.default;
  const flush = () => {
    let count = 0;
    while (dirty || effects.length) {
      assert(++count < 100, 'Selection effects must settle without another automatic read loop');
      if (dirty) { dirty = false; cursor = 0; tree = Component(props); }
      const next = effects; effects = []; next.forEach(callback => callback());
    }
  };
  const tick = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); flush(); } };
  const nodes = (type, node = tree) => {
    if (!node || typeof node !== 'object') return [];
    const children = Array.isArray(node) ? node : node.props?.children || [];
    return [...(node.type === type ? [node] : []), ...children.flatMap(child => nodes(type, child))];
  };
  const text = node => typeof node === 'string' ? node : !node || typeof node !== 'object' ? ''
    : (Array.isArray(node) ? node : node.props?.children || []).map(text).join(' ');
  const button = label => { const result = nodes('button').find(node => text(node).trim() === label); assert(result, label); return result; };
  const select = (id, value) => { const node = nodes('select').find(node => node.props.id === id); assert(node, id);
    node.props.onChange({ target: { value } }); flush(); };
  const click = label => { button(label).props.onClick(); flush(); };
  const pending = () => calls.filter(call => !call.settled);
  const settle = async () => { assert.equal(pending().length, 1); pending()[0].resolve(); await tick(); };
  const update = callback => { callback(auth, props); dirty = true; flush(); };
  flush();
  return { calls, saves, toasts, nodes, button, select, click, tick, pending, settle, update, flush,
    preview: () => nodes('WisHallOfFameStudentPreview')[0]?.props,
    dispose: () => { disposed = true; slots.forEach(slot => slot?.cleanup?.()); } };
};

const checks = [];
const check = async (name, run) => { await run(); checks.push(name); };
await check('initial default group is requested once; selector normalization never triggers a second query', async () => {
  const page = fixture(); assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0].selection.view, 'grade'); assert.equal(page.calls[0].selection.gradeKey, '');
  await page.settle(); assert.equal(page.calls.length, 1); assert.equal(page.pending().length, 0);
  assert.equal(page.preview().gradeKey, '1');
  assert.equal(page.nodes('select').find(node => node.props.id === 'hall-preview-class').props.value, '1-1');
  assert.equal(typeof page.nodes('div')[0].props['data-hall-load-ms'], 'number'); page.dispose();
});
await check('view, grade and class selections request exactly one active group and retain all selector keys', async () => {
  const page = fixture(); await page.settle();
  const options = page.nodes('select').find(node => node.props.id === 'hall-preview-grade').props.children.flat(Infinity).filter(node => node?.type === 'option');
  assert.equal(options.length, 2);
  page.click('학급'); assert.equal(page.calls.length, 2);
  assert.equal(page.calls.at(-1).selection.view, 'class'); assert.equal(page.calls.at(-1).selection.classKey, '1-1');
  await page.settle();
  page.select('hall-preview-class', '1-2'); assert.equal(page.calls.length, 3);
  assert.equal(page.calls.at(-1).selection.classKey, '1-2'); await page.settle();
  page.select('hall-preview-grade', '2'); assert.equal(page.calls.length, 4);
  assert.equal(page.calls.at(-1).selection.classKey, '2-1'); await page.settle();
  assert.equal(page.preview().currentGrade, '2'); assert.equal(page.preview().currentClass, '1');
  assert.equal(page.preview().snapshot.classLeaderboardByClassKey['1-2'].length, 0, 'Previous groups are never merged into the accepted snapshot');
  page.click('전교'); assert.equal(page.calls.length, 5);
  assert.equal(page.calls.at(-1).selection.gradeKey, '2'); await page.settle(); assert.equal(page.calls.length, 5); page.dispose();
});
await check('changing an inactive class selector does not fetch an unshown group', async () => {
  const page = fixture(); await page.settle(); page.select('hall-preview-class', '1-2');
  assert.equal(page.calls.length, 1); page.click('학급');
  assert.equal(page.calls.length, 2); assert.equal(page.calls.at(-1).selection.classKey, '1-2'); await page.settle(); page.dispose();
});
await check('late previous-group responses cannot overwrite the currently selected group', async () => {
  const page = fixture(); await page.settle();
  const gradeHandler = page.nodes('select').find(node => node.props.id === 'hall-preview-grade').props.onChange;
  gradeHandler({ target: { value: '2' } }); page.flush(); const old = page.pending()[0];
  gradeHandler({ target: { value: '1' } }); page.flush(); const fresh = page.pending().find(call => call !== old);
  fresh.resolve(); await page.tick(); const accepted = page.preview().snapshot.snapshotKey;
  old.resolve(); await page.tick(); assert.equal(page.preview().snapshot.snapshotKey, accepted);
  assert.equal(page.preview().gradeKey, '1'); assert.equal(page.calls.length, 3); page.dispose();
});
await check('a removed requested class accepts the populated server fallback instead of a different numeric first option', async () => {
  const page = fixture();
  page.pending()[0].resolve({ year: '2026', semester: '2', primaryGradeKey: '3',
    gradeLeaderboardByGrade: { '3': [] }, gradeTop3ByGrade: { '3': [] },
    classLeaderboardByClassKey: { '3-1': [], '3-2': [], '3-10': [] },
    classTop3ByClassKey: { '3-1': [], '3-2': [], '3-10': [] } }); await page.tick();
  page.click('학급'); assert.equal(page.calls.at(-1).selection.classKey, '3-1');
  const rows = [{ uid: 'accepted-3-10', grade: '3', class: '10', rank: 1, cumulativeEarned: 100 }];
  page.pending()[0].resolve({ year: '2026', semester: '2', primaryGradeKey: '3',
    gradeLeaderboardByGrade: { '3': [] }, gradeTop3ByGrade: { '3': [] },
    classLeaderboardByClassKey: { '3-2': [], '3-10': rows },
    classTop3ByClassKey: { '3-2': [], '3-10': rows } }); await page.tick();
  assert.equal(page.preview().currentGrade, '3'); assert.equal(page.preview().currentClass, '10');
  assert.equal(page.nodes('select').find(node => node.props.id === 'hall-preview-class').props.value, '3-10');
  assert.equal(page.preview().snapshot.classLeaderboardByClassKey['3-10'][0].uid, 'accepted-3-10');
  assert.equal(page.calls.length, 2, 'Accepted fallback normalization cannot start another group request'); page.dispose();
});
await check('refreshKey and manual refresh reload only the selected group while preserving unsaved feature drafts', async () => {
  const page = fixture(); await page.settle(); page.click('학급'); await page.settle(); page.select('hall-preview-class', '1-2'); await page.settle();
  const input = page.nodes('NumericInput')[0]; input.props.onChange({ target: { value: '7' } }); page.flush();
  assert.equal(page.nodes('NumericInput')[0].props.value, 7);
  const before = page.calls.length; page.update((_auth, props) => { props.refreshKey++; });
  assert.equal(page.calls.length, before + 1); assert.equal(page.calls.at(-1).selection.classKey, '1-2'); await page.settle();
  assert.equal(page.nodes('NumericInput')[0].props.value, 7);
  page.click('새로고침'); assert.equal(page.calls.length, before + 2); assert.equal(page.calls.at(-1).selection.view, 'class'); await page.settle();
  assert.equal(page.nodes('NumericInput')[0].props.value, 7); assert.equal(page.pending().length, 0); page.dispose();
});
await check('save reload uses the latest selected group after a concurrent view change', async () => {
  const page = fixture(); await page.settle(); page.nodes('NumericInput')[0].props.onChange({ target: { value: '7' } }); page.flush();
  page.click('변경사항 저장'); assert.equal(page.saves.length, 1);
  page.click('학급'); await page.settle(); page.select('hall-preview-class', '1-2'); await page.settle();
  const before = page.calls.length; page.saves[0].resolve(); await page.tick();
  assert.equal(page.calls.length, before + 1); assert.equal(page.calls.at(-1).selection.view, 'class');
  assert.equal(page.calls.at(-1).selection.classKey, '1-2'); await page.settle(); assert.equal(page.pending().length, 0); page.dispose();
});
await check('account, auth generation and semester changes reject stale responses and no request starts after logout', async () => {
  const page = fixture(), old = page.pending()[0];
  page.update((auth, props) => { auth.currentUser = { uid: 'teacher-b' }; auth.authGeneration++; props.config = { ...props.config, semester: '1' }; });
  const fresh = page.pending().find(call => call !== old); fresh.resolve(); await page.tick();
  const key = page.preview().snapshot.snapshotKey; old.resolve(); await page.tick();
  assert.equal(page.preview().snapshot.snapshotKey, key); assert.match(key, /^teacher-b:1:/);
  const before = page.calls.length; page.update(auth => { auth.currentUser = null; auth.authGeneration++; });
  assert.equal(page.calls.length, before); assert.equal(page.preview()?.snapshot, null); page.dispose();
});
await check('read errors stop loading without polling and explicit refresh retries only the current scope', async () => {
  const page = fixture(); page.pending()[0].reject(); await page.tick();
  assert.equal(page.calls.length, 1); page.click('새로고침'); assert.equal(page.calls.length, 2);
  await page.settle(); assert.equal(page.calls.length, 2); assert(page.preview()); page.dispose();
});
assert.equal(/getWisHallOfFameSnapshot|setInterval|setTimeout/.test(fs.readFileSync(path.join(root, sourceFile), 'utf8')), false);
console.log(JSON.stringify({ status: 'PASS', network: 0, checks,
  scope: 'Actual teacher Hall hooks/effects with real Hall config helpers; scoped network and save boundaries are synthetic.' }, null, 2));
