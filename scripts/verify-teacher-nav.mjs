import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const headerPath = resolve('src/components/common/Header.tsx');
const headerSource = readFileSync(headerPath, 'utf8');

const match = headerSource.match(/const desktopSubmenuParentUrls = new Set\(\[([\s\S]*?)\]\);/);
if (!match) {
  throw new Error('desktopSubmenuParentUrls set was not found in Header.tsx.');
}

const submenuParents = Array.from(match[1].matchAll(/'([^']+)'/g), ([, value]) => value);
const pagesWithOwnTabs = ['/teacher/quiz', '/teacher/exam', '/teacher/points'];
const duplicatedParents = pagesWithOwnTabs.filter((url) => submenuParents.includes(url));

if (duplicatedParents.length > 0) {
  throw new Error(
    `Teacher pages with their own tab bars must not also render header submenus: ${duplicatedParents.join(', ')}`,
  );
}

console.log('Teacher nav submenu guard passed.');
