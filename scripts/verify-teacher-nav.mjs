import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const headerPath = resolve('src/components/common/Header.tsx');
const headerSource = readFileSync(headerPath, 'utf8');

const match = headerSource.match(/const desktopSubmenuParentUrls = new Set\(\[([\s\S]*?)\]\);/);
if (!match) {
  throw new Error('desktopSubmenuParentUrls set was not found in Header.tsx.');
}

const submenuParents = Array.from(match[1].matchAll(/["']([^"']+)["']/g), ([, value]) => value);
const pagesWithOwnTabs = ['/teacher/quiz', '/teacher/exam', '/teacher/points'];
const duplicatedParents = pagesWithOwnTabs.filter((url) => submenuParents.includes(url));

if (duplicatedParents.length > 0) {
  throw new Error(
    `Teacher pages with their own tab bars must not also render header submenus: ${duplicatedParents.join(', ')}`,
  );
}

console.log('Teacher nav submenu guard passed.');

// Render the actual navigation with synthetic identities. No Firebase or effects run.
let auth;
let location;
let mobile = false;
const cache = new Map();
const router = {
  Link: ({ to, children, ...props }) => React.createElement('a', { ...props, href: `#${to}` }, children),
  useLocation: () => location,
  useNavigate: () => () => {},
};
const stubs = {
  useStudentWisStocks: { useStudentWisStockStatus: () => ({ status: 'ready', data: { studentOpen: false, halted: true }, error: '', retry() {} }) },
  AuthContext: { useAuth: () => auth },
  firebase: { auth: { currentUser: null } },
  AppToastProvider: { useAppToast: () => ({ showToast() {} }) },
  PointRankBadge: { default: () => null },
  HeaderStudentWis: { default: () => null },
  semesterArchive: { isSemesterArchive: false },
  lazyWithRetry: { lazyWithRetry: () => () => null },
  profileEmojis: { getDefaultProfileEmojiValue: () => '😀' },
  studentProfileEmoji: { resolveStudentProfileEmoji: () => ({ rank: null, allowedEmojiIds: ['smile'], entry: { id: 'smile', emoji: '😀' } }) },
  safeStorage: { readLocalOnly: () => null, removeStorage() {}, writeLocalOnly() {} },
  browserTasks: {},
  sessionActivity: {},
};
const load = (filename) => {
  const file = resolve(filename);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, {
    exports, console, URLSearchParams,
    window: { matchMedia: () => ({ matches: mobile }) },
    require: (name) => {
      if (name.endsWith('.css')) return {};
      if (/\.(webp|png|svg)$/.test(name)) {
        const asset = resolve(dirname(file), name);
        assert(existsSync(asset), `Missing asset: ${name}`);
        return { __esModule: true, default: asset };
      }
      if (name === 'react') return { ...React, useLayoutEffect: React.useEffect };
      if (name === 'react-router-dom') return router;
      if (stubs[basename(name)]) return { __esModule: true, ...stubs[basename(name)] };
      assert(name.startsWith('.'), `Unexpected dependency: ${name}`);
      const target = resolve(dirname(file), name);
      return load([`${target}.ts`, `${target}.tsx`].find(existsSync));
    },
  }, { filename: file });
  return exports;
};
const { MENUS, cloneDefaultMenus, sanitizeMenuConfig } = load('src/constants/menus.ts');
const { ADMIN_EMAIL, canAccessTeacherPath } = load('src/lib/permissions.ts');
const Header = load('src/components/common/Header.tsx').default;
const qnaPath = '/teacher/gongsinmoongo';
const legacy = cloneDefaultMenus();
legacy.teacher = legacy.teacher.filter(item => item.url !== qnaPath);
const migrated = sanitizeMenuConfig(sanitizeMenuConfig(legacy));
assert.equal(migrated.teacher.filter(item => item.url === qnaPath).length, 1, 'Saved menus gain exactly one Q&A entry');
assert.equal(MENUS.student.some(item => item.url === qnaPath || item.children?.some(child => child.url === qnaPath)), false, 'No student menu receives Q&A');

function renderNavigation(role, email, menus = migrated, collapsed = false) {
  const student = role === 'student';
  location = { pathname: student ? '/student/dashboard' : qnaPath, search: '' };
  auth = {
    currentUser: { uid: `navigation-${role}`, email },
    userData: { uid: `navigation-${role}`, role, email, name: '메뉴 검증', teacherPortalEnabled: role === 'staff', staffPermissions: role === 'staff' ? ['lesson_read', 'quiz_read'] : [] },
    config: { year: '2026', semester: '2', showLesson: true, showQuiz: true, showScore: true },
    configReady: true, menuConfigReady: true, menuConfig: menus, logout: async () => {},
  };
  return renderToStaticMarkup(React.createElement(Header, {
    teacherLayout: !student, studentLayout: student, sidebarCollapsed: collapsed,
  }));
}
for (const small of [false, true]) {
  mobile = small;
  for (const collapsed of [false, true]) {
    const html = renderNavigation('teacher', ADMIN_EMAIL, migrated, collapsed);
    const groupLabels = [...html.matchAll(/<(?:a|button)\b[^>]*class="teacher-sidebar-item [^"]*"[^>]*>/g)]
      .map(([tag]) => tag.match(/aria-label="([^"]+)"/)?.[1]).filter(Boolean);
    assert.equal(groupLabels[groupLabels.indexOf('역사 사전') + 1], '공부의 神문고', 'Q&A follows the dictionary as an independent group');
    assert.equal([...html.matchAll(/href="#\/teacher\/gongsinmoongo"/g)].length, 1, 'Q&A is not duplicated inside the learning group');
    assert.match(html, /<a(?=[^>]*href="#\/teacher\/gongsinmoongo")(?=[^>]*aria-current="page")[^>]*>/, 'Direct Q&A route is active');
  }
  for (const role of ['teacher', 'staff', 'student']) {
    const email = `${role}@fixture.invalid`;
    const html = renderNavigation(role, email);
    const allowed = role === 'teacher';
    assert.equal(html.includes(`href="#${qnaPath}"`), allowed, `${role} Q&A menu follows teacher access`);
    assert.equal(canAccessTeacherPath(qnaPath, auth.userData, email), allowed, `${role} direct Q&A route follows teacher access`);
    assert.equal(canAccessTeacherPath(`${qnaPath}/preview`, auth.userData, email), allowed, `${role} nested Q&A route follows teacher access`);
  }
}
assert.equal(canAccessTeacherPath(qnaPath, { role: 'teacher' }, ADMIN_EMAIL), true);
assert.equal(canAccessTeacherPath(qnaPath, { role: 'staff', email: ADMIN_EMAIL }, 'staff@fixture.invalid'), false, 'Unverified profile email cannot unlock teacher access');
assert.equal(canAccessTeacherPath(qnaPath, null, null), false);
assert.equal(canAccessTeacherPath('/teacher/lesson', { role: 'staff', teacherPortalEnabled: true, staffPermissions: ['lesson_read'] }, 'staff@fixture.invalid'), true, 'Existing lesson staff access stays unchanged');
const renamed = cloneDefaultMenus();
Object.assign(renamed.teacher.find(item => item.url === qnaPath), { name: '우리 반 공신문고', nameCustomized: true });
assert(renderNavigation('teacher', ADMIN_EMAIL, sanitizeMenuConfig(renamed)).includes('aria-label="우리 반 공신문고"'), 'Configured label is retained');
assert(!readFileSync(resolve('src/pages/teacher/Settings.tsx'), 'utf8').includes('Gongsinmoongo'), 'Q&A no longer exists inside settings');
console.log('PASS: teacher-access standalone Q&A, dictionary-adjacent placement, saved menu migration, active route, student/staff exclusion, configured labels and unchanged lesson access.');

const previousStudentOrder = ['/student/lesson/note', '/student/quiz', '/student/score', '/student/points', '/student/mypage', '/student/weplay'];
const previous = cloneDefaultMenus();
delete previous.orderVersion;
previous.student.sort((left, right) => previousStudentOrder.indexOf(left.url) - previousStudentOrder.indexOf(right.url));
previous.student.find(item => item.url === '/student/weplay').children = previous.student.find(item => item.url === '/student/weplay').children.filter(child => !child.url.includes('gungdeok-rock'));
const updated = sanitizeMenuConfig(previous);
assert.deepEqual(Array.from(updated.student, item => item.url), Array.from(MENUS.student, item => item.url), 'Previous default order becomes Weplay, Wis, MyPage');
assert.equal(updated.student.find(item => item.url === '/student/weplay').children.filter(child => child.url.includes('gungdeok-rock')).length, 1, 'Rhythm game gains exactly one menu entry');
updated.student.sort((left, right) => previousStudentOrder.indexOf(left.url) - previousStudentOrder.indexOf(right.url));
assert.deepEqual(Array.from(sanitizeMenuConfig(updated).student, item => item.url), previousStudentOrder, 'An explicit saved order is never migrated again');
const studentMarkup = renderNavigation('student', 'student@fixture.invalid');
assert(studentMarkup.indexOf('aria-label="위플레이"') < studentMarkup.indexOf('aria-label="위스"'), 'Weplay precedes Wis by default');
assert.match(studentMarkup, /teacher-sidebar-bottom[\s\S]*<a(?=[^>]*href="#\/student\/mypage")(?=[^>]*aria-label="마이페이지")[^>]*>/, 'MyPage is a direct bottom link');
assert(!studentMarkup.includes('id="student-menu-mypage"'), 'MyPage is not duplicated in the primary accordion');
const reordered = cloneDefaultMenus();
reordered.teacher.unshift(reordered.teacher.splice(reordered.teacher.findIndex(item => item.url === qnaPath), 1)[0]);
const reorderedMarkup = renderNavigation('teacher', ADMIN_EMAIL, sanitizeMenuConfig(reordered));
assert(reorderedMarkup.indexOf('aria-label="공부의 神문고"') < reorderedMarkup.indexOf('aria-label="학습 자료 관리"'), 'Configured teacher parent order is respected');
for (const portal of ['teacher', 'student']) {
  const custom = cloneDefaultMenus();
  const points = custom[portal].find(item => item.url === `/${portal}/points`);
  const shop = points.children.splice(points.children.findIndex(child => child.url === `/${portal}/points?tab=${portal === 'teacher' ? 'products' : 'shop'}`), 1)[0];
  points.children.unshift(shop);
  const html = renderNavigation(portal, portal === 'teacher' ? ADMIN_EMAIL : 'student@fixture.invalid', sanitizeMenuConfig(custom));
  const group = html.slice(html.indexOf(`id="${portal}-menu-points"`));
  assert(group.indexOf(`href="#${shop.url}"`) < group.indexOf(`href="#/${portal}/points"`), `${portal} Wis children respect the saved order after consolidation`);
}
console.log('PASS: default menu migration, saved custom order, rhythm entry, bottom MyPage and both portals\' configured sidebar order.');
