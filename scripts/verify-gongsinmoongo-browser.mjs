/** Actual live workspace/source helpers with a deterministic in-memory server. No production access. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const root = process.cwd();
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const evidence =
  process.env.GONGSINMOONGO_LIVE_EVIDENCE_DIR ||
  path.join(root, "output/gongsinmoongo-live-browser-20261110");
await fs.mkdir(evidence, { recursive: true });
const manifest = JSON.parse(
  await fs.readFile(
    path.join(root, "scripts/content/gongsinmoongo-launch.json"),
    "utf8",
  ),
);
const imageTags = [manifest.cover, ...manifest.panels].map(
  (asset) =>
    `<figure><img src="/assets/${asset.file}" alt="${asset.alt}" width="${asset.file === "hero.webp" ? 1200 : 1024}" height="${asset.file === "hero.webp" ? 675 : 1536}"></figure>`,
);
const article = `<article class="westory-event-article we-notice-images we-notice-images--reopen"><div class="we-notice-images__cover">${imageTags[0]}</div><section class="we-notice-images__details">${imageTags.slice(1).join("")}</section></article>`;
// DeveloperLog selects its single-column event/image renderer only for notice posts.
// A direct NoticeImageArticle fixture alone cannot catch an incorrect post category.
const developerLogSource = await fs.readFile(
  path.join(root, "src/pages/DeveloperLog.tsx"),
  "utf8",
);
assert.equal(
  manifest.category,
  "notice",
  "Image announcement must select DeveloperLog's notice/event layout instead of the empty card-news column",
);
assert.match(
  developerLogSource,
  /post\.category === "notice"\s*&&\s*hasEventArticleMarkup\(post\.bodyHtml\)/,
);
assert.match(
  developerLogSource,
  /eventArticle\s*&&\s*hasNoticeImageArticleMarkup\(post\.bodyHtml\)/,
);
assert.match(
  article,
  /<article[^>]*class="[^"]*westory-event-article[^"]*we-notice-images/,
);
assert.match(article, /we-notice-images__cover/);
assert.match(article, /we-notice-images__details/);
const service = `
import {useSyncExternalStore} from 'react';
const params=new URLSearchParams(location.search), teacher=params.get('role')!=='student';
const authListeners=new Set(), gates=new Set(), clone=value=>JSON.parse(JSON.stringify(value));
const settings={enabled:!params.has('closed'),revision:1,acceptingQuestions:true,storiesVisible:true,teacherQuestionNotifications:true,studentReplyNotifications:true,warning:{enabled:true,title:'질문 전 약속',body:'학습 내용만 질문해 주세요. 사담과 도배는 질문 제한 사유가 됩니다.',revision:1},allowedSources:['lesson','dictionary','mock','formative','diagnostic'],defaultRestrictionMs:3600000};
const row=(id,studentId,label,question,reply='',emoji='book')=>({id,studentId,studentLabel:label,profileEmojiId:emoji,source:{kind:'lesson',title:'조선 전기의 대외 관계',unitId:'unit-a'},question,reply,publicQuestion:'교린은 어떤 관계인가요?',publicReply:'이웃 나라와의 관계를 살펴보세요.',selected:!!reply,createdAt:1794300000000+Number(id.replace(/\\D/g,''))*1000,updatedAt:1794300000000,revision:1});
export const qa=window.gongsinLiveQa={teacher,user:{uid:teacher?'teacher-a':'student-a',email:'fixture@example.invalid'},config:{year:'2026',semester:'2'},reads:[],writes:[],toasts:[],listenerCount:0,listenerStopped:0,settings,ack:params.has('ack')?1:0,restriction:params.has('restricted')?{until:Date.now()+3600000,reason:'학습과 관계없는 대화 반복'}:null,rows:[row('q1','student-a','예시 학생 A','4군 6진의 위치가 궁금해요.','압록강과 두만강을 먼저 찾아보세요.'),row('q2','student-a','예시 학생 A','교린 관계의 근거를 어떻게 찾아요?'),row('q3','student-b','다른 학생 B','다른 학생의 비공개 질문이므로 학생 A에게 보이면 안 됩니다.')],receipts:new Map(),failRead:params.has('read-error')?'state':'',failAction:'',holdAction:'',holdRead:'',commitThenFail:false};
if(params.has('many'))qa.rows.push(...Array.from({length:24},(_,i)=>row('q'+(i+4),'student-a','예시 학생 A','합성 질문 '+(i+4))));
qa.setGate=enabled=>{settings.enabled=enabled;settings.revision++;gates.forEach(cb=>cb({data:()=>({enabled,revision:settings.revision})}));};
qa.switchAccount=uid=>{qa.user={uid,email:'fixture@example.invalid'};auth.currentUser=qa.user;authListeners.forEach(cb=>cb());};
export const auth={currentUser:qa.user},db={};
export const useAuth=()=>{useSyncExternalStore(cb=>{authListeners.add(cb);return()=>authListeners.delete(cb)},()=>qa.user);return {currentUser:qa.user,user:qa.user,userData:{uid:qa.user.uid,role:teacher?'teacher':'student'},config:qa.config,configReady:true,interfaceConfig:{footerText:'Westory'},menuConfig:null};};
export const useAppToast=()=>({showToast:value=>qa.toasts.push(value)});
export const doc=(_db,...segments)=>({path:segments.join('/')});
export const getDoc=async()=>{throw Error('Unexpected Firestore get in offline fixture')};
export const onSnapshot=(ref,success)=>{qa.listenerCount++;gates.add(success);queueMicrotask(()=>success({data:()=>({enabled:settings.enabled,revision:settings.revision})}));return()=>{qa.listenerStopped++;gates.delete(success)};};
const waitRead=async mode=>{if(qa.holdRead===mode){qa.holdRead='';await new Promise(resolve=>qa.releaseRead=resolve)}};
export const getHttpsCallable=async name=>async input=>{
 if(name==='getGongsinmoongo'){
  qa.reads.push(clone(input));const uid=qa.user.uid;
  if(qa.failRead===input.mode){qa.failRead='';throw Error('합성 읽기 실패. 다시 시도해 주세요.');}
  let result;
  if(input.mode==='state')result={role:teacher?'teacher':'student',settings:clone(settings),canManageSettings:teacher,restriction:clone(qa.restriction),acknowledgedWarningRevision:qa.ack};
  else if(input.mode==='questions'){let rows=qa.rows.filter(q=>teacher?(!input.studentId||q.studentId===input.studentId):q.studentId===uid);if(input.filter==='waiting')rows=rows.filter(q=>!q.reply);if(input.filter==='selected')rows=rows.filter(q=>q.selected);const start=Number(input.cursor||0);result={items:clone(rows.slice(start,start+20)),nextCursor:start+20<rows.length?String(start+20):null};}
  else if(input.mode==='detail'){const question=qa.rows.find(q=>q.id===input.questionId&&(teacher||q.studentId===uid));if(!question)throw Error('이 질문을 볼 수 없습니다.');result={question:clone(question)};}
  else if(input.mode==='stories')result={items:[{id:'public-1',question:'교린은 어떤 관계인가요?',answer:'이웃 나라와의 관계를 살펴보세요.',source:{kind:'lesson',unitId:'unit-a',title:'조선 전기의 대외 관계'}}],nextCursor:null};
  else if(input.mode==='restrictions')result={items:qa.restriction?[{...qa.restriction,studentId:'student-a',studentLabel:'예시 학생 A'}]:[],nextCursor:null};
  else throw Error('Unexpected read '+input.mode);
  await waitRead(input.mode);return {data:result};
 }
 if(name!=='manageGongsinmoongo')throw Error('Unexpected callable '+name);
 qa.writes.push(clone(input));let result;
 if(qa.receipts.has(input.requestId))return {data:{...clone(qa.receipts.get(input.requestId)),replayed:true}};
 if(qa.failAction===input.action&&!qa.commitThenFail){qa.failAction='';throw Error('합성 저장 실패. 다시 시도해 주세요.');}
 if(input.action==='ack'){qa.ack=input.warningRevision;result={acknowledgedWarningRevision:qa.ack,replayed:false};}
 else if(input.action==='submit'){if(!settings.enabled||qa.restriction?.until>Date.now())throw Error('지금은 질문을 보낼 수 없습니다.');const q=row('q'+(qa.rows.length+1),qa.user.uid,'예시 학생 A',input.question);q.source=input.source;qa.rows.push(q);result={question:clone(q),replayed:false};}
 else if(input.action==='answer'||input.action==='story'){const q=qa.rows.find(q=>q.id===input.questionId);if(input.expectedRevision!==q.revision)throw Error('다른 변경이 있습니다.');if(input.action==='answer')q.reply=input.reply;else Object.assign(q,{publicQuestion:input.publicQuestion,publicReply:input.publicReply,selected:input.selected});q.revision++;result={question:clone(q),replayed:false};}
 else if(input.action==='settings'){Object.assign(settings,clone(input.settings),{revision:settings.revision+1});result={settings:clone(settings),replayed:false};}
 else if(input.action==='restrict'){qa.restriction=input.durationMs?{until:Date.now()+input.durationMs,reason:input.reason}:null;result={restriction:clone(qa.restriction),replayed:false};}
 else throw Error('Unexpected mutation '+input.action);
 qa.receipts.set(input.requestId,clone(result));
 if(qa.holdAction===input.action){qa.holdAction='';await new Promise(resolve=>qa.releaseMutation=resolve);}
 if(qa.failAction===input.action){qa.failAction='';qa.commitThenFail=false;throw Error('응답을 확인하지 못했습니다. 다시 시도해 주세요.');}
 return {data:result};
};
export const callWithApplicationSession=async(name,input)=>{const call=await getHttpsCallable(name);return call(input)};
export const loadMyQuizHistory=async input=>({semesterId:input.semesterId,rows:[],totalCount:0,nextCursor:null});
export const loadMyQuizHistoryDetail=async(semesterId,key)=>({semesterId,key,record:{id:'saved-paper',title:'합성 평가 결과',category:params.get('category')||'exam_prep',recordedAtMs:1794300000000,score:0,details:[{id:'saved-1',correct:false,u:'고려',questionSnapshot:{type:'choice',question:'한양을 도읍으로 삼은 나라는?',options:['고려','조선'],answer:'조선',explanation:'조선은 한양으로 도읍을 옮겼습니다.'}}]}});
export const saveMyQuizReviewNote=async()=>{throw Error('No saved-answer mutations in Q&A fixture')};
export const watchQuizResultCorrections=()=>()=>{};
export default function InertLessonPopup(){return null};
`;
const harness = `
import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';
import Workspace from './src/components/common/GongsinmoongoWorkspace';
import NoticeImageArticle from './src/components/common/NoticeImageArticle';
import MyQuizHistory from './src/pages/student/mypage/MyQuizHistory';
import{PortalWorkspaceFooterProvider,PortalFallbackFooter}from'./src/components/common/PortalWorkspace';
import{getGongsinQuestionUrl,parseGongsinSource}from'./src/lib/gongsinmoongo';
import{qa}from'fixture:service';import'./src/assets/index.css';import'./src/components/layout/teacherLayout.css';import'./src/pages/developerEventArticles.css';
window.gongsinSourceHelpers={getGongsinQuestionUrl,parseGongsinSource};
const params=new URLSearchParams(location.search),articleMode=params.has('article'),historyMode=params.has('history');
const url=(qa.teacher?'/teacher':'/student')+'/gongsinmoongo'+(params.get('question')?'?question='+params.get('question'):'');
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[url]}><PortalWorkspaceFooterProvider>{articleMode?<main className="developer-log-rich-text developer-log-image-post"><NoticeImageArticle bodyHtml={${JSON.stringify(article)}} title={${JSON.stringify(manifest.title)}}/></main>:historyMode?<main className="ws-page"><MyQuizHistory semesterId={params.has('archive')?'2026-1':'2026-2'} active requestedAttemptId="saved-paper" onSelect={()=>{}} onClose={()=>{}} onStart={()=>{}}/></main>:<div className={'flex min-h-screen flex-col bg-gray-50 '+(qa.teacher?'teacher-layout':'student-layout')}><aside className="teacher-sidebar" aria-hidden="true"><div className="teacher-sidebar-brand-row">Westory</div></aside><header className="teacher-header teacher-account-header"><div className="header-container"><div className="teacher-header-start">Westory</div><div className="header-right"><span>{qa.teacher?'예시 교사':'예시 학생'}</span><button type="button" aria-label="기존 상단 알림">알림</button><button className="btn-logout" disabled>로그아웃</button></div></div></header><main className="min-h-0 w-full flex-1"><Workspace teacher={qa.teacher}/></main><PortalFallbackFooter teacher/></div>}</PortalWorkspaceFooterProvider></MemoryRouter>);
`;
const bundle = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  metafile: true,
  outdir: "fixture",
  format: "esm",
  platform: "browser",
  target: "es2022",
  loader: {
    ".svg": "dataurl",
    ".webp": "dataurl",
    ".woff": "dataurl",
    ".woff2": "dataurl",
  },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "offline-services",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^(?:fixture:service|firebase\/firestore)$|(?:^|\/)(?:firebase|applicationSession|AuthContext|AppToastProvider|myQuizHistory|quizReviewNotes|quizResultCorrections|QuizLessonPopup)$/,
          },
          () => ({ path: "service", namespace: "offline" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
          contents: service,
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
assert(
  !Object.keys(bundle.metafile.inputs).some((file) =>
    /node_modules[\\/](?:firebase|@firebase)[\\/]/.test(file),
  ),
  "No live Firebase runtime in fixture",
);
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles
  .filter((file) => file.path.endsWith(".css"))
  .map((file) => file.text)
  .join("\n")
  .replace(/@import\s+(?:url\()?['"]https?:[^;]+;/g, "");
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/assets/")) {
    const filename = path.basename(url.pathname);
    if (
      ![manifest.cover, ...manifest.panels].some(
        (item) => item.file === filename,
      )
    ) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("content-type", "image/webp");
    res.end(
      await fs.readFile(
        path.join(root, "public", manifest.publicRoot, filename),
      ),
    );
    return;
  }
  const entry = {
    "/fixture.js": ["text/javascript", js],
    "/fixture.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
  }[url.pathname] || ["text/html", html];
  res.setHeader("content-type", entry[0] + "; charset=utf-8");
  res.end(entry[1]);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const errors = [],
  external = [],
  checks = [],
  bounds = [],
  requestCounts = [];
async function pageAt(query = "", width = 1280, height = 720) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith("data:"))
      return route.continue();
    external.push(url);
    return route.abort();
  });
  await page.goto(origin + "/" + query);
  return page;
}
async function acknowledge(page) {
  const dialog = page.getByRole("dialog", { name: "질문 전 약속" });
  await dialog.waitFor();
  assert.equal(
    await dialog.getByRole("button", { name: "확인하고 시작하기" }).isEnabled(),
    false,
  );
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "확인하고 시작하기" }).click();
  await dialog.waitFor({ state: "hidden" });
}
try {
  for (const role of ["teacher", "student"]) {
    for (const [width, height] of [
      [320, 800],
      [390, 844],
      [768, 900],
      [1280, 720],
      [1440, 900],
    ]) {
      const page = await pageAt(`?role=${role}&ack`, width, height);
      await page.locator(".gsm-conversation .gsm-thread").first().waitFor();
      assert.equal(
        await page.locator('.gsm-workspace button[aria-label*="알림"]').count(),
        0,
        "No separate Q&A bell",
      );
      assert.equal(
        await page.locator('button[aria-label="기존 상단 알림"]').count(),
        1,
      );
      if (role === "student") {
        assert.equal(
          await page
            .getByText(
              "다른 학생의 비공개 질문이므로 학생 A에게 보이면 안 됩니다.",
              { exact: true },
            )
            .count(),
          0,
        );
        assert.equal(
          await page
            .getByRole("button", { name: "운영 설정", exact: true })
            .count(),
          0,
        );
      }
      const geometry = await page.evaluate(() => {
        const box = (selector) => {
          const r = document.querySelector(selector)?.getBoundingClientRect();
          return r
            ? {
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                bottom: r.bottom,
              }
            : null;
        };
        return {
          width: innerWidth,
          height: innerHeight,
          pageWidth: document.documentElement.scrollWidth,
          pageHeight: document.documentElement.scrollHeight,
          conversation: box(".gsm-conversation"),
          composer: box(".gsm-composer"),
          header: box(".gsm-chat-header"),
          actions: box(".gsm-teacher-actions"),
          name: box(".gsm-chat-header h2"),
          sidebar: box(".gsm-sidebar"),
          grid: getComputedStyle(document.querySelector(".gsm-workspace"))
            .gridTemplateColumns,
          teacherLayout: !!document.querySelector(".teacher-layout"),
          sidebarScroll:
            document.querySelector(".gsm-question-list")?.scrollHeight >
            document.querySelector(".gsm-question-list")?.clientHeight + 1,
        };
      });
      bounds.push({ role, ...geometry });
      if (role === "student" && width === 768)
        assert(
          geometry.conversation.width >= width - 40,
          "Tablet student workspace fills the single column",
        );
      assert(
        geometry.pageWidth <= width + 1,
        `${role} horizontal overflow at ${width}`,
      );
      if (width >= 1280) {
        assert(
          geometry.pageHeight <= height + 1,
          `${role} page scroll at ${width}x${height}: ${geometry.pageHeight}`,
        );
        assert(geometry.composer.bottom <= height + 1);
        assert(geometry.conversation.height >= 300);
        if (role === "student")
          assert(
            geometry.conversation.width >= width - 320,
            "Student chat uses the full workspace width",
          );
        if (role === "teacher") {
          assert.equal(
            Math.round(geometry.sidebar.width),
            320,
            "Desktop teacher question list is 320px",
          );
          assert.equal(geometry.sidebarScroll, false);
          assert(
            Math.abs(
              geometry.actions.y +
                geometry.actions.height / 2 -
                geometry.name.y -
                geometry.name.height / 2,
            ) <= 2,
            "One-row student/actions header",
          );
        }
      }
      assert.equal(
        await page.evaluate(() => window.gongsinLiveQa.listenerCount),
        1,
        "One shared public-state listener",
      );
      const readCounts = await page.evaluate(() => {
        const qa = window.gongsinLiveQa;
        return {
          state: qa.reads.filter((x) => x.mode === "state").length,
          questions: qa.reads.filter((x) => x.mode === "questions").length,
          writes: qa.writes.length,
        };
      });
      assert.deepEqual(readCounts, {
        state: 1,
        questions: role === "teacher" ? 2 : 1,
        writes: 0,
      });
      requestCounts.push({ role, width, phase: "initial", ...readCounts });
      await page.screenshot({
        path: path.join(evidence, `${role}-${width}x${height}.png`),
        fullPage: true,
      });
      await page.close();
    }
  }
  checks.push(
    "teacher/student responsive layout, desktop viewport, compact header, private DOM, shared gate listener, existing bell only",
  );
  const student = await pageAt("?role=student");
  await acknowledge(student);
  assert.equal(
    await student.evaluate(
      () =>
        window.gongsinLiveQa.writes.filter((x) => x.action === "ack").length,
    ),
    1,
  );
  const input = student.locator("#gongsin-question"),
    send = student.getByRole("button", { name: "질문 보내기", exact: true });
  await input.fill("답변 알림 연결을 확인하는 합성 질문입니다.");
  await student.evaluate(() => {
    window.gongsinLiveQa.failAction = "submit";
    window.gongsinLiveQa.commitThenFail = true;
  });
  await send.click();
  await student.getByRole("alert").waitFor();
  assert.equal(
    await input.inputValue(),
    "답변 알림 연결을 확인하는 합성 질문입니다.",
  );
  await send.click();
  await student.waitForFunction(
    () => document.querySelector("#gongsin-question").value === "",
  );
  const retry = await student.evaluate(() => {
    const writes = window.gongsinLiveQa.writes.filter(
      (x) => x.action === "submit",
    );
    return {
      ids: writes.map((x) => x.requestId),
      records: window.gongsinLiveQa.rows.filter(
        (x) => x.question === "답변 알림 연결을 확인하는 합성 질문입니다.",
      ).length,
    };
  });
  assert.equal(retry.ids.length, 2);
  assert.equal(retry.ids[0], retry.ids[1]);
  assert.equal(retry.records, 1);
  await student.getByRole("button", { name: /선생님 스토리/ }).click();
  const story = student.getByRole("dialog", {
    name: "선생님 스토리",
    exact: true,
  });
  await story.waitFor();
  assert(
    !/예시 학생|다른 학생|student-a|student-b/.test(await story.innerText()),
  );
  await student.keyboard.press("Escape");
  await student.evaluate(() => window.gongsinLiveQa.setGate(false));
  await student
    .getByText("지금은 질문함을 이용할 수 없습니다.", { exact: true })
    .waitFor();
  assert.equal(await student.locator(".gsm-thread").count(), 0);
  await student.close();
  checks.push(
    "first-use acknowledgement, failed response retry reuses request ID without duplicate, sanitized story, live closure removes personal conversation",
  );
  const restricted = await pageAt("?role=student&ack&restricted");
  await restricted.locator("#gongsin-question").waitFor();
  assert.equal(
    await restricted.locator("#gongsin-question").isEnabled(),
    false,
  );
  assert.match(
    await restricted.locator(".gsm-restriction").innerText(),
    /학습과 관계없는 대화/,
  );
  await restricted.close();
  const failed = await pageAt("?role=student&ack&read-error");
  await failed.getByRole("alert").waitFor();
  await failed
    .getByRole("button", { name: "다시 불러오기", exact: true })
    .click();
  await failed.locator(".gsm-thread").first().waitFor();
  await failed.close();
  checks.push("restriction disables composer; initial read error recovers");
  const paged = await pageAt("?role=teacher&many");
  await paged.locator(".gsm-thread").first().waitFor();
  const initialReads = await paged.evaluate(
    () => window.gongsinLiveQa.reads.length,
  );
  for (let pageIndex = 0; pageIndex < 4; pageIndex++)
    await paged
      .getByRole("button", { name: "다음 질문 목록", exact: true })
      .click();
  assert.equal(
    await paged.evaluate(() => window.gongsinLiveQa.reads.length),
    initialReads,
    "Four local pages reuse the loaded 20 rows",
  );
  await paged
    .getByRole("button", { name: "다음 질문 목록", exact: true })
    .click();
  await paged.waitForFunction(() =>
    window.gongsinLiveQa.reads.some((x) => x.cursor === "20"),
  );
  await paged.locator(".gsm-filter select").selectOption("waiting");
  await paged.waitForFunction(() =>
    window.gongsinLiveQa.reads.some((x) => x.filter === "waiting"),
  );
  const pagedReads = await paged.evaluate(() => ({
    state: window.gongsinLiveQa.reads.filter((x) => x.mode === "state").length,
    requests: window.gongsinLiveQa.reads,
    writes: window.gongsinLiveQa.writes.length,
  }));
  assert.equal(
    pagedReads.state,
    1,
    "Pagination and filters reuse identity/revision-scoped settings",
  );
  assert.equal(pagedReads.writes, 0);
  requestCounts.push({
    role: "teacher",
    phase: "pagination/filter",
    ...pagedReads,
  });
  await paged.close();
  checks.push(
    "20-row cursor reads, four local page changes add zero reads/writes, filters do not reread settings",
  );
  const teacher = await pageAt("?role=teacher");
  await teacher.locator("#gongsin-reply").waitFor();
  await teacher
    .locator("#gongsin-reply")
    .fill("자료의 근거를 함께 살펴보세요.");
  await teacher
    .getByRole("button", { name: "답변 보내기", exact: true })
    .click();
  await teacher.waitForFunction(() =>
    window.gongsinLiveQa.writes.some((x) => x.action === "answer"),
  );
  await teacher
    .getByRole("button", { name: "공개용 문구 편집", exact: true })
    .click();
  const editor = teacher.getByRole("dialog", {
    name: "공개용 문구 편집",
    exact: true,
  });
  await editor
    .getByRole("textbox", { name: /^공개 질문/ })
    .fill("공개할 개념 질문");
  await editor
    .getByRole("textbox", { name: /^공개 답변/ })
    .fill("누구나 함께 볼 수 있는 개념 답변");
  await editor.getByRole("checkbox").check();
  await editor.getByRole("button", { name: /스토리 (수정|선정)/ }).click();
  await editor.waitFor({ state: "hidden" });
  await teacher.getByRole("button", { name: "질문 제한", exact: true }).click();
  const discipline = teacher.getByRole("dialog", {
    name: "예시 학생 A 질문 제한",
    exact: true,
  });
  await discipline.getByLabel("제한 기간").selectOption("86400000");
  await discipline
    .getByLabel("학생에게 표시할 사유")
    .fill("학습 질문과 관계없는 대화 반복");
  await discipline
    .getByRole("button", { name: "제한 적용", exact: true })
    .click();
  await discipline.waitFor({ state: "hidden" });
  await teacher.getByRole("button", { name: "운영 설정", exact: true }).click();
  assert.equal(
    await teacher.evaluate(
      () =>
        window.gongsinLiveQa.reads.filter((x) => x.mode === "restrictions")
          .length,
    ),
    0,
  );
  await teacher.getByRole("button", { name: "알림", exact: true }).click();
  await teacher.getByLabel("새 질문을 기존 교사 알림으로 받기").uncheck();
  await teacher
    .getByRole("button", { name: "변경사항 저장", exact: true })
    .click();
  await teacher.waitForFunction(() =>
    window.gongsinLiveQa.writes.some(
      (x) =>
        x.action === "settings" &&
        x.settings.teacherQuestionNotifications === false,
    ),
  );
  await teacher.getByRole("button", { name: "학생 제한", exact: true }).click();
  await teacher
    .getByText("학습 질문과 관계없는 대화 반복", { exact: false })
    .waitFor();
  assert.equal(
    await teacher.evaluate(
      () =>
        window.gongsinLiveQa.reads.filter((x) => x.mode === "restrictions")
          .length,
    ),
    1,
  );
  await teacher.close();
  checks.push(
    "teacher reply, curated text, time restriction, existing notification toggle persistence, unopened-tab read avoidance",
  );
  const race = await pageAt("?role=student&ack");
  await race.locator("#gongsin-question").waitFor();
  await race.locator("#gongsin-question").fill("계정 A에만 남아야 하는 질문");
  await race.evaluate(() => (window.gongsinLiveQa.holdAction = "submit"));
  await race.getByRole("button", { name: "질문 보내기", exact: true }).click();
  await race.waitForFunction(
    () => typeof window.gongsinLiveQa.releaseMutation === "function",
  );
  await race.evaluate(() => window.gongsinLiveQa.switchAccount("student-b"));
  await race.waitForFunction(
    () =>
      window.gongsinLiveQa.reads.filter((x) => x.mode === "state").length >= 2,
  );
  await race.evaluate(() => window.gongsinLiveQa.releaseMutation());
  await race.waitForTimeout(100);
  assert.equal(
    await race
      .getByText("계정 A에만 남아야 하는 질문", { exact: true })
      .count(),
    0,
    "Late mutation from previous account must not enter new account DOM",
  );
  await race.close();
  checks.push("late mutation account-boundary privacy");
  for (const category of ["exam_prep", "formative", "diagnostic"]) {
    const page = await pageAt(
      `?history&role=student&ack&category=${category}`,
      390,
      844,
    );
    const link = page.getByRole("link", {
      name: "이 문항 질문하기 (새 탭)",
      exact: true,
    });
    await link.waitFor();
    const target = new URL(await link.getAttribute("href"), origin);
    assert.equal(
      target.searchParams.get("source"),
      category === "exam_prep" ? "mock" : category,
    );
    assert.equal(target.searchParams.get("resultKey"), "canonical:saved-paper");
    assert.equal(target.searchParams.get("questionId"), "saved-1");
    assert.equal(
      target.searchParams.get("origin"),
      category === "exam_prep" ? "wrong-note" : null,
    );
    assert.equal(await link.getAttribute("target"), "_blank");
    assert(!target.href.includes("한양"));
    await page.evaluate(() => window.gongsinLiveQa.setGate(false));
    await link.waitFor({ state: "hidden" });
    await page.close();
  }
  const archived = await pageAt("?history&role=student&ack&archive");
  await archived
    .getByRole("region", { name: "오답 복습", exact: true })
    .waitFor();
  assert.equal(
    await archived
      .getByRole("link", { name: "이 문항 질문하기 (새 탭)", exact: true })
      .count(),
    0,
  );
  await archived.close();
  checks.push(
    "actual mock/formative/diagnostic notebook source CTA, correct result/question IDs, input-preserving new tab, current-semester and live-gate checks",
  );
  for (const width of [390, 768, 1280]) {
    const page = await pageAt("?article", width, 900);
    await page.locator(".we-notice-images__cover img").waitFor();
    await page.getByRole("button", { name: "더보기", exact: true }).click();
    await page
      .locator(".we-notice-images__details img")
      .last()
      .scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    const images = await page
      .locator(".we-notice-images img")
      .evaluateAll((items) =>
        items.map((image) => ({
          loaded: image.complete && image.naturalWidth > 0,
          width: image.getBoundingClientRect().width,
          alt: image.alt,
        })),
      );
    assert(
      images.every(
        (image) =>
          image.loaded && image.width <= 720.1 && image.alt.length > 20,
      ),
    );
    await page.screenshot({
      path: path.join(evidence, `article-${width}.png`),
      fullPage: true,
    });
    await page.close();
  }
  checks.push(
    "actual image article 390/768/1280, alt text, no crop/overflow, 720px maximum",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  const report = {
    pass: true,
    checks,
    bounds,
    requestCounts,
    errors,
    external,
  };
  await fs.rm(path.join(evidence, "failure.json"), { force: true });
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ pass: true, evidence, checks }, null, 2));
} catch (error) {
  await fs.writeFile(
    path.join(evidence, "failure.json"),
    JSON.stringify(
      { message: error.message, stack: error.stack, bounds, errors, external },
      null,
      2,
    ),
  );
  for (const [index, page] of browser
    .contexts()
    .flatMap((context) => context.pages())
    .entries()) {
    await page.screenshot({
      path: path.join(evidence, `failure-${index}.png`),
      fullPage: true,
    });
    await fs.writeFile(
      path.join(evidence, `failure-${index}.html`),
      await page.content(),
    );
  }
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
