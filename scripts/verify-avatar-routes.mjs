/** Route/menu regression fixture. Uses real routing and access logic, synthetic identities only. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "output/avatar-wardrobe-20261114/routes");
await fs.mkdir(output, { recursive: true });
const sources = {};
for (const file of [
  "student/Points",
  "student/MyPage",
  "teacher/ManagePoints",
  "teacher/Settings",
]) {
  sources[file] = await fs.readFile(
    path.join(root, `src/pages/${file}.tsx`),
    "utf8",
  );
}
// Verify inactive wardrobe does not start the unrelated profile/score/rank loaders.
assert.match(
  sources["student/MyPage"],
  /if \(isAvatarWardrobe\) \{\s*setMyPageLoading\(false\);\s*return;\s*\}\s*void loadMyPage\(\)/,
);
assert.match(
  sources["student/MyPage"],
  /if \(isAvatarWardrobe\) return;\s*void loadPointRankState\(\)/,
);
assert.match(sources["student/MyPage"], /menu !== "score" \|\| !canUseScore/);
assert.match(sources["student/MyPage"], /<StudentAvatarStudio mode="wardrobe"/);
assert.doesNotMatch(
  sources["teacher/Settings"],
  /import\("\.\/components\/SettingsAvatarPricing"\)/,
);

const entry = `
import React,{useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route,useLocation,useNavigate} from 'react-router-dom';
import {sanitizeMenuConfig,cloneDefaultMenus} from './src/constants/menus';
import Header from './src/components/common/Header';
import StudentPointsRoute from './src/pages/student/Points';
import MyPageRoute from './src/pages/student/MyPage';
import TeacherPointsRoute from './src/pages/teacher/ManagePoints';
import SettingsRoute from './src/pages/teacher/Settings';
import './src/components/common/portalPage.css';
const query=new URLSearchParams(location.search),scenario=query.get('scenario')||'student';
const menu=cloneDefaultMenus();
const studentPoints=menu.student.find(m=>m.url==='/student/points');
const wardrobe=menu.student.find(m=>m.url==='/student/mypage').children.find(c=>c.url.endsWith('menu=avatar'));
const avatar=studentPoints.children.find(c=>c.url.includes('shop=avatar'));
if(scenario==='old-config'){studentPoints.children=studentPoints.children.filter(c=>!c.url.includes('shop=avatar'));wardrobe.name='아바타 꾸미기';}
if(scenario==='custom'){avatar.name='우리 반 패션';avatar.nameCustomized=true;wardrobe.name='나의 옷';wardrobe.nameCustomized=true;studentPoints.children.find(c=>c.url==='/student/points?tab=shop').name='학급 상품';}
if(scenario==='hidden-shop')avatar.hidden=true;
if(scenario==='hidden-avatar')wardrobe.hidden=true;
if(scenario==='hidden-products')studentPoints.children.find(c=>c.url==='/student/points?tab=shop').hidden=true;
if(scenario==='custom-teacher'){const c=menu.teacher.find(m=>m.url==='/teacher/points').children.find(c=>c.url.includes('shop=avatar'));c.name='상품 꾸미기';c.nameCustomized=true;}
const staff=scenario==='staff',teacher=staff||scenario.includes('teacher');
const qa=window.avatarRouteQa={legacyMounts:[],studioReads:0,pricingReads:0,errors:[],auth:{currentUser:{uid:'synthetic-user',email:teacher?'synthetic-teacher@example.invalid':'synthetic-student@example.invalid'},userData:{role:teacher?(staff?'staff':'teacher'):'student',teacherPortalEnabled:staff,staffPermissions:staff?['point_read']:[],name:'검증 계정'},config:{year:'2026',semester:'2',showQuiz:true,showScore:true,showLesson:true,studentMenuVisibility:{mypage:true,avatar:scenario!=='closed-avatar',...(scenario==='closed-shop'?{avatar_shop:false}:{})}},menuConfig:sanitizeMenuConfig(menu),configReady:true,menuConfigReady:true,authGeneration:1,logout:async()=>{}}};
window.addEventListener('error',event=>qa.errors.push(event.message));
window.addEventListener('unhandledrejection',event=>qa.errors.push(String(event.reason)));
function App(){const current=useLocation(),navigate=useNavigate();qa.navigate=navigate;qa.location=current.pathname+current.search;return <><Header studentLayout={!teacher} teacherLayout={teacher}/><div id="route-content"><Routes><Route path="/student/points" element={<StudentPointsRoute/>}/><Route path="/student/mypage" element={<MyPageRoute/>}/><Route path="/teacher/points" element={<TeacherPointsRoute/>}/><Route path="/teacher/settings" element={<SettingsRoute/>}/></Routes></div></>}
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[query.get('route')||'/student/points?tab=shop&shop=avatar']}><App/></MemoryRouter>);
`;

const mocks = {
  AuthContext: `export const useAuth=()=>window.avatarRouteQa.auth;`,
  firebase: `export const auth={currentUser:null},db={},functions={},storage={},app={};`,
  browserTasks: `export const runAfterNextPaint=()=>()=>{};`,
  AppToastProvider: `export const useAppToast=()=>({showToast:()=>{}});`,
  HeaderStudentWis: `export default ()=>null;`,
  NotificationBell: `export default ()=>null;`,
  pointRankPromotion: `export const loadStudentRankPromotionSnapshot=()=>{throw Error('Unexpected header read')},invalidateStudentRankPromotionSnapshotCache=()=>{};`,
  TeacherSidebar: `import React from 'react';import {Link} from 'react-router-dom';export default function Sidebar({groups,isChildActive}){return <aside data-testid="sidebar">{groups.map(g=><section key={g.id} data-group={g.id}><h2>{g.name}</h2>{g.children.map(c=><Link key={c.resolvedUrl} to={c.resolvedUrl} aria-current={isChildActive(c.resolvedUrl,g.children)?'page':undefined}>{c.name}</Link>)}</section>)}</aside>}`,
  AvatarStudio: `import React,{useEffect} from 'react';export default function Studio({mode='wardrobe'}){useEffect(()=>{window.avatarRouteQa.studioReads++},[]);return <div data-testid="studio" data-mode={mode}>아바타 {mode}</div>}`,
  SettingsAvatarPricing: `import React,{useEffect} from 'react';export default function Pricing(){useEffect(()=>{window.avatarRouteQa.pricingReads++},[]);return <div data-testid="pricing">상품 편집</div>}`,
};
const result = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  outdir: output,
  loader: { ".webp": "dataurl" },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "synthetic-route-services",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /\/(AuthContext|firebase|browserTasks|AppToastProvider|HeaderStudentWis|NotificationBell|pointRankPromotion|TeacherSidebar|AvatarStudio|SettingsAvatarPricing)$/,
          },
          (args) => ({ path: path.basename(args.path), namespace: "mock" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
          contents: mocks[args.path],
          loader: "tsx",
          resolveDir: root,
        }));
        // Keep the production route-selection functions verbatim, instrument their heavy legacy pages.
        plugin.onLoad(
          {
            filter:
              /[\\/]pages[\\/](student[\\/](Points|MyPage)|teacher[\\/](ManagePoints|Settings))\.tsx$/,
          },
          (args) => {
            const key = args.path
              .replaceAll("\\", "/")
              .split("/pages/")[1]
              .replace(/\.tsx$/, "");
            const wrapper = sources[key].slice(
              sources[key].lastIndexOf("export default function"),
            );
            const name = path.basename(key);
            const legacy = name === "ManagePoints" ? "ManagePoints" : name;
            return {
              contents: `import React,{useEffect} from 'react';import {Navigate,useSearchParams} from 'react-router-dom';import {isStudentAvatarShop,isTeacherAvatarShop,TEACHER_AVATAR_SHOP_URL} from '${root.replaceAll("\\", "/")}/src/lib/avatarRoutes';import StudentAvatarShopPage from '${root.replaceAll("\\", "/")}/src/pages/student/components/points/StudentAvatarShopPage';import TeacherAvatarShopPage from '${root.replaceAll("\\", "/")}/src/pages/teacher/components/points/TeacherAvatarShopPage';function ${legacy}(){const[p]=useSearchParams();useEffect(()=>{window.avatarRouteQa.legacyMounts.push('${legacy}')},[]);return <div data-testid="legacy" data-menu={p.get('menu')}>${legacy}</div>}\n${wrapper}`,
              loader: "tsx",
              resolveDir: path.dirname(args.path),
            };
          },
        );
      },
    },
  ],
});
const js = result.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css =
  result.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "";
const server = http.createServer((req, res) => {
  res.setHeader(
    "content-type",
    req.url === "/app.js" ? "text/javascript" : "text/html; charset=utf-8",
  );
  res.end(
    req.url === "/app.js"
      ? js
      : `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="root"></div><script type="module" src="/app.js"></script>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    process.env.PLAYWRIGHT_MODULE_PATH ||
      path.join(
        os.homedir(),
        ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
      ),
  );
}
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const page = await browser.newPage();
const reports = [];
const open = async (
  scenario,
  route = "/student/points?tab=shop&shop=avatar",
) => {
  await page.goto(`${base}/?${new URLSearchParams({ scenario, route })}`);
  await page.waitForFunction(() => window.avatarRouteQa?.location);
  await page.locator("#route-content").waitFor();
};
const inspect = async (name) => {
  const qa = await page.evaluate(() => ({
    location: window.avatarRouteQa.location,
    legacyMounts: window.avatarRouteQa.legacyMounts,
    studioReads: window.avatarRouteQa.studioReads,
    pricingReads: window.avatarRouteQa.pricingReads,
    errors: window.avatarRouteQa.errors,
  }));
  assert.deepEqual(qa.errors, []);
  reports.push({ name, ...qa });
  return qa;
};
try {
  for (const scenario of ["student", "old-config", "custom"]) {
    await open(scenario);
    await page.getByTestId("studio").waitFor();
    assert.equal(
      await page.getByTestId("studio").getAttribute("data-mode"),
      "shop",
    );
    const qa = await inspect(scenario);
    assert.deepEqual(qa.legacyMounts, []);
    assert.equal(qa.studioReads, 1);
    assert.equal(qa.pricingReads, 0);
    const shop = page.locator('[data-group="shop"]');
    assert.equal(await shop.locator("a").count(), 3);
    assert.equal(await shop.locator('a[aria-current="page"]').count(), 1);
    assert.match(
      await shop.locator('a[aria-current="page"]').getAttribute("href"),
      /tab=shop&shop=avatar/,
    );
    assert.equal(
      await page.locator('[data-group="points"] a[href*="tab=shop"]').count(),
      0,
    );
    if (scenario === "custom") {
      assert.equal(
        await shop.getByRole("link", { name: "우리 반 패션" }).count(),
        1,
      );
      assert.equal(
        await page
          .getByRole("navigation", { name: "위스 상점 상품 종류" })
          .getByRole("link", { name: "우리 반 패션" })
          .count(),
        1,
      );
      assert.equal(
        await page
          .locator('[data-group="mypage"]')
          .getByRole("link", { name: "나의 옷" })
          .count(),
        1,
      );
    } else
      assert.equal(
        await page
          .locator('[data-group="mypage"]')
          .getByRole("link", { name: "아바타 옷장" })
          .count(),
        1,
      );
  }
  for (const scenario of [
    "hidden-shop",
    "hidden-avatar",
    "closed-avatar",
    "closed-shop",
    "hidden-products",
  ]) {
    await open(scenario);
    await page.getByRole("alert").waitFor();
    const qa = await inspect(scenario);
    assert.equal(qa.studioReads, 0);
    assert.deepEqual(qa.legacyMounts, []);
    assert.equal(
      await page.locator('[data-group="shop"] a[href*="shop=avatar"]').count(),
      0,
    );
  }
  await open("student", "/student/points?tab=shop");
  await page.getByTestId("legacy").waitFor();
  assert.deepEqual((await inspect("general shop")).legacyMounts, ["Points"]);
  for (const route of [
    "/student/mypage?menu=avatar",
    "/student/mypage?menu=wardrobe&keep=1",
  ]) {
    await open("student", route);
    await page.getByTestId("legacy").waitFor();
    assert.equal(
      await page.getByTestId("legacy").getAttribute("data-menu"),
      "avatar",
    );
    const qa = await inspect("wardrobe bookmark");
    assert.deepEqual(qa.legacyMounts, ["MyPage"]);
    assert.match(qa.location, /menu=avatar/);
    if (route.includes("keep")) assert.match(qa.location, /keep=1/);
  }
  for (const scenario of ["teacher", "custom-teacher"]) {
    await open(scenario, "/teacher/points?tab=products&shop=avatar");
    await page.getByTestId("pricing").waitFor();
    const qa = await inspect(scenario);
    assert.deepEqual(qa.legacyMounts, []);
    assert.equal(qa.pricingReads, 1);
    const shop = page.locator('[data-group="shop"]');
    assert.equal(await shop.locator('a[aria-current="page"]').count(), 1);
    assert.equal(
      await shop
        .getByRole("link", {
          name:
            scenario === "custom-teacher"
              ? "상품 꾸미기"
              : "아바타 아이템 관리",
        })
        .count(),
      1,
    );
  }
  await open("staff", "/teacher/points?tab=products&shop=avatar");
  await page.getByRole("alert").waitFor();
  const denied = await inspect("staff rejected");
  assert.equal(denied.pricingReads, 0);
  assert.deepEqual(denied.legacyMounts, []);
  assert.equal(
    await page.locator('[data-group="shop"] a[href*="shop=avatar"]').count(),
    0,
  );
  for (const key of ["tab", "section", "menu"]) {
    await open("teacher", `/teacher/settings?${key}=avatar-pricing`);
    await page.getByTestId("pricing").waitFor();
    const qa = await inspect(`legacy settings ${key}`);
    assert.equal(qa.location, "/teacher/points?tab=products&shop=avatar");
    assert.deepEqual(qa.legacyMounts, []);
    assert.equal(qa.pricingReads, 1);
  }
  await open("teacher", "/teacher/points?tab=products");
  await page.getByTestId("legacy").waitFor();
  assert.deepEqual((await inspect("teacher general products")).legacyMounts, [
    "ManagePoints",
  ]);
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(
      { passed: true, staticInactiveLoadGuards: true, checks: reports },
      null,
      2,
    ),
  );
  console.log(
    `PASS avatar routes: ${reports.length} scenarios; real menu merge, query preservation, custom labels/hidden entries, both student gates, teacher admin gate, legacy normalization and inactive legacy page isolation.`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
