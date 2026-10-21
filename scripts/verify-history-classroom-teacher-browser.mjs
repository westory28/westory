/** Exercises the actual teacher component with an in-memory Firestore boundary.
 * No live Firebase reads, writes, notifications, or callable requests are made.
 * Manual browser QA: node scripts/verify-history-classroom-teacher-browser.mjs --serve --port=4176
 * Scenarios: /?scenario=dashboard, new, failure, edit, attempts, ticket,
 * no-ticket, exempted, or exemption-failure. Use the app's controls
 * to open forms; the fixture toolbar only seeds scenarios and arms one failure.
 * --serve never imports Playwright, starts a browser, or downloads assets.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const serveOnly = process.argv.includes("--serve");
const portArgument = process.argv.find((argument) => argument.startsWith("--port="));
const servePort = Number(portArgument?.split("=")[1] || process.env.HISTORY_CLASSROOM_FIXTURE_PORT || 4176);
assert(Number.isInteger(servePort) && servePort >= 0 && servePort <= 65535, "Fixture port must be an integer from 0 to 65535");
let playwright;
if (!serveOnly) {
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
}
const evidence = path.join(
  root,
  ".superloopy/sessions/history-classroom-followup/evidence",
);
if (!serveOnly) await fs.mkdir(evidence, { recursive: true });
const cache = process.env.TAILWIND_FIXTURE_PATH || path.join(os.tmpdir(), "westory-tailwind-fixture.js");
let tailwind;
try {
  tailwind = await fs.readFile(cache, "utf8");
} catch {
  if (serveOnly) throw new Error(`Offline fixture requires a local Tailwind script: ${cache}. Set TAILWIND_FIXTURE_PATH to an existing local file.`);
  const response = await fetch("https://cdn.tailwindcss.com/3.4.17");
  assert(response.ok);
  tailwind = await response.text();
  await fs.writeFile(cache, tailwind);
}
const scope = "years/2026/semesters/2";
const longTitle =
  "고대 국가의 성립과 발전 및 한반도와 동아시아의 교류를 살펴보는 긴 수업 자료 목차";
const pageImages = [1, 3].map((page) => ({
  page,
  imageUrl: `/worksheet.svg?page=${page}`,
  width: 1000,
  height: 1400,
}));
const originalBlanks = [
  {
    id: "saved-ocr",
    page: 1,
    leftRatio: 0.125,
    topRatio: 0.235,
    widthRatio: 0.1875,
    heightRatio: 0.0275,
    answer: "고조선",
    prompt: "나라 이름",
    source: "ocr",
  },
  {
    id: "saved-manual",
    page: 3,
    leftRatio: 0.325,
    topRatio: 0.435,
    widthRatio: 0.1375,
    heightRatio: 0.0375,
    answer: "삼국 시대",
    prompt: "시대 이름",
    source: "manual",
  },
];
const lesson = (unitId, title, answer) => ({
  unitId,
  title,
  worksheetPageImages: pageImages,
  worksheetBlanks: answer
    ? [{ ...originalBlanks[0], id: `saved-${unitId}`, answer }]
    : originalBlanks,
  worksheetTextRegions: [],
});
const map = {
  title: "한반도 지도",
  type: "pdf",
  sortOrder: 0,
  pdfPageImages: pageImages,
  pdfRegions: [],
  pdfBlanks: [
    {
      id: "map-blank",
      page: 1,
      left: 120,
      top: 240,
      width: 160,
      height: 40,
      answer: "평양",
      prompt: "도시",
      source: "manual",
    },
  ],
};
const store = {
  [`${scope}/curriculum/tree`]: {
    tree: [
      {
        id: "chapter",
        title: "II. 고대 사회",
        children: [
          {
            id: "middle",
            title: "국가의 형성",
            children: [
              { id: "b", title: "2. 삼국", children: [] },
              { id: "a", title: longTitle, children: [] },
            ],
          },
          {
            id: "middle-other",
            title: "국가의 형성",
            children: [{ id: "d", title: "2. 삼국", children: [] }],
          },
        ],
      },
      {
        id: "chapter-copy",
        title: "II. 고대 사회",
        children: [
          {
            id: "middle-copy",
            title: "국가의 형성",
            children: [{ id: "c", title: "2. 삼국", children: [] }],
          },
        ],
      },
    ],
  },
  [`${scope}/lessons/c`]: lesson("c", "중복 제목 수업", "신라"),
  [`${scope}/lessons/d`]: lesson("d", "다른 중목차 수업", "고구려"),
  [`${scope}/lessons/b`]: lesson("b", "삼국 수업", "백제"),
  [`${scope}/lessons/a`]: lesson("a", longTitle),
  [`${scope}/map_resources/map-1`]: map,
  "users/student-1": {
    role: "student",
    name: "검증학생",
    grade: "3",
    class: "2",
    number: "3",
  },
};
// The server mode uses only synthetic students. New/failure scenarios start
// with an empty dashboard; use the actual app's new/edit controls to enter forms.
const serveStore = structuredClone(store);
delete serveStore["users/student-1"];
const syntheticStudents = Array.from({ length: 34 }, (_, index) => ({
  uid: `synthetic-student-${String(index + 1).padStart(2, "0")}`,
  name: `합성학생${String(index + 1).padStart(2, "0")}`,
  number: String(index + 1),
}));
for (const student of syntheticStudents) {
  serveStore[`users/${student.uid}`] = { role: "student", name: student.name, grade: "3", class: "2", number: student.number };
}
serveStore["users/synthetic-other-class"] = {
  role: "student", name: "합성다른학급긴이름학생", grade: "2", class: "3", number: "1",
};
const assignedStudents = syntheticStudents.slice(0, 24);
const seededAssignmentPath = `${scope}/history_classrooms/synthetic-long-assignment`;
serveStore[seededAssignmentPath] = {
  title: longTitle,
  sourceType: "lesson", lessonUnitId: "a", lessonTitle: longTitle,
  lessonUnitPath: ["II. 고대 사회", "국가의 형성", longTitle],
  mapResourceId: "", mapTitle: "", description: "",
  pdfPageImages: pageImages, pdfRegions: [],
  blanks: originalBlanks.map((blank) => ({ id: blank.id, page: blank.page,
    left: blank.leftRatio * 1000, top: blank.topRatio * 1400,
    width: blank.widthRatio * 1000, height: blank.heightRatio * 1400,
    answer: blank.answer, prompt: blank.prompt, source: blank.source })),
  answerOptions: originalBlanks.map((blank) => blank.answer),
  timeLimitMinutes: 10, cooldownMinutes: 5, dueWindowDays: null, passThresholdPercent: 90,
  targetGrade: "3", targetClass: "2", targetStudentUid: assignedStudents[0].uid,
  targetStudentUids: assignedStudents.map((student) => student.uid),
  targetStudentNames: assignedStudents.map((student) => student.name),
  targetStudentName: assignedStudents.map((student) => student.name).join(", "),
  targetStudentNumber: assignedStudents.map((student) => student.number).join(", "),
  targetStudentAccessMap: Object.fromEntries(assignedStudents.map((student) => [student.uid, true])),
  targetStudentReasons: Object.fromEntries(assignedStudents.map((student, index) => [student.uid,
    index % 3 === 0 ? "지각" : index % 3 === 1 ? "수업 태도" : "합성 검증용 개별 사유"])),
  contentRevision: 1, isPublished: true,
  createdAt: { seconds: 1792022400, nanoseconds: 0 },
  updatedAt: { seconds: 1792022400, nanoseconds: 0 },
  publishedAt: { seconds: 1792022400, nanoseconds: 0 }, dueAt: null,
};
const attemptsStore = structuredClone(serveStore);
Object.assign(attemptsStore[seededAssignmentPath], {
  targetStudentUids: syntheticStudents.map((student) => student.uid),
  targetStudentNames: syntheticStudents.map((student) => student.name),
  targetStudentName: syntheticStudents.map((student) => student.name).join(", "),
  targetStudentNumber: syntheticStudents.map((student) => student.number).join(", "),
  targetStudentAccessMap: Object.fromEntries(syntheticStudents.map((student) => [student.uid, true])),
  targetStudentReasons: Object.fromEntries(syntheticStudents.map((student, index) => [student.uid,
    index % 3 === 0 ? "지각" : index % 3 === 1 ? "수업 태도" : "합성 검증용 개별 사유"])),
});
const fixtureAssignmentId = seededAssignmentPath.split("/").at(-1);
const fixtureTimestamp = { seconds: 1792022400, nanoseconds: 0 };
const syntheticTicket = (student, status = "available") => ({
  uid: student.uid, studentName: student.name, studentGrade: "3", studentClass: "2",
  studentNumber: student.number, reason: "합성 수업 활동 참여", status,
  grantedByUid: "teacher-fixture", grantScope: "student", createdAt: fixtureTimestamp,
  updatedAt: fixtureTimestamp, ...(status === "used" ? { usedAssignmentId: fixtureAssignmentId,
    usedByUid: "teacher-fixture", usedAt: fixtureTimestamp } : {}),
});
const syntheticResult = (student, status, exemption = false) => ({
  assignmentId: fixtureAssignmentId, assignmentTitle: longTitle, uid: student.uid,
  studentName: student.name, studentGrade: "3", studentClass: "2", studentNumber: student.number,
  status, passed: status === "passed", percent: status === "passed" ? 100 : 50,
  score: status === "passed" ? 2 : 1, total: 2, passThresholdPercent: 90,
  answers: exemption ? {} : { "saved-ocr": "고조선", "saved-manual": "삼국 시대" }, answerChecks: [],
  completionSource: exemption ? "exemption" : "attempt", createdAt: fixtureTimestamp,
  ...(exemption ? { exemptionId: `synthetic-ticket-${student.uid}`, approvedByUid: "teacher-fixture", approvedAt: fixtureTimestamp } : {}),
});
for (const [index, student] of syntheticStudents.entries()) {
  if (index === 0 || index === 3 || (index >= 6 && index % 2 === 0)) {
    attemptsStore[`${scope}/history_classroom_exemptions/synthetic-ticket-${student.uid}`] = syntheticTicket(student);
  }
  if (index === 2) {
    attemptsStore[`${scope}/history_classroom_exemptions/synthetic-ticket-${student.uid}`] = syntheticTicket(student, "used");
    attemptsStore[`${scope}/history_classroom_results/synthetic-exempt-${student.uid}`] = syntheticResult(student, "passed", true);
  } else if (index === 4 || index === 5 || index >= 8 && index % 3 === 0) {
    attemptsStore[`${scope}/history_classroom_results/synthetic-attempt-${student.uid}`] = syntheticResult(student, index === 5 ? "passed" : "failed");
  }
}
const pendingStudent = syntheticStudents[6];
const pendingRequestId = "synthetic-pending-request";
attemptsStore[`${scope}/history_classroom_exemptions/synthetic-requested-${pendingStudent.uid}`] = {
  ...syntheticTicket(pendingStudent, "requested"), pendingRequestId,
  exemptionRequestId: pendingRequestId, requestedAssignmentId: fixtureAssignmentId,
};
attemptsStore[`${scope}/history_classroom_exemption_requests/${pendingRequestId}`] = {
  uid: pendingStudent.uid, studentName: pendingStudent.name, studentGrade: "3", studentClass: "2",
  studentNumber: pendingStudent.number, assignmentId: fixtureAssignmentId, assignmentTitle: longTitle,
  exemptionId: `synthetic-requested-${pendingStudent.uid}`, exemptionReason: "합성 대기 요청",
  status: "pending", requestedAt: fixtureTimestamp, createdAt: fixtureTimestamp, updatedAt: fixtureTimestamp,
};
const restrictedStudent = syntheticStudents[7];
attemptsStore[`${scope}/history_classroom_exemptions/synthetic-other-assignment-${restrictedStudent.uid}`] = {
  ...syntheticTicket(restrictedStudent), assignmentId: "synthetic-other-assignment",
  createdAt: { ...fixtureTimestamp, seconds: fixtureTimestamp.seconds + 1 },
};
attemptsStore[`${scope}/history_classroom_exemptions/synthetic-ticket-${restrictedStudent.uid}`] = syntheticTicket(restrictedStudent);
const legacyTicketStudent = syntheticStudents[8];
attemptsStore[`${scope}/history_classroom_exemptions/synthetic-legacy-used-${legacyTicketStudent.uid}`] = {
  ...syntheticTicket(legacyTicketStudent, "active"), state: "consumed", usedAt: fixtureTimestamp,
  usedAssignmentId: "synthetic-other-assignment", usedByUid: legacyTicketStudent.uid,
  createdAt: { ...fixtureTimestamp, seconds: fixtureTimestamp.seconds + 1 },
};
const mock = `
const serveMode=${serveOnly};
const scenario=serveMode ? new URLSearchParams(window.location.search).get('scenario') || 'dashboard' : 'automated';
const attemptScenario=['attempts','ticket','no-ticket','exempted','exemption-failure'].includes(scenario);
const fixture=window.__fixture={store:attemptScenario?${JSON.stringify(attemptsStore)}:${JSON.stringify(serveOnly ? serveStore : store)},writes:[],successfulWrites:[],failedWrites:[],notifications:[],reads:[],alerts:[],commands:[],commandResults:[],failedCommands:[],scenario};
if(serveMode && ['no-ticket','exempted'].includes(scenario)) delete fixture.store[${JSON.stringify(`${scope}/history_classroom_exemptions/synthetic-ticket-${syntheticStudents[0].uid}`)}];
if(serveMode && scenario==='exempted') {
 fixture.store[${JSON.stringify(`${scope}/history_classroom_exemptions/synthetic-ticket-${syntheticStudents[0].uid}`)}]=${JSON.stringify(syntheticTicket(syntheticStudents[0], "used"))};
 fixture.store[${JSON.stringify(`${scope}/history_classroom_results/synthetic-exempt-${syntheticStudents[0].uid}`)}]=${JSON.stringify(syntheticResult(syntheticStudents[0], "passed", true))};
}
if(serveMode && scenario==='exemption-failure') fixture.failNextExemption=true;
if(serveMode && ['new','failure'].includes(fixture.scenario)) delete fixture.store[${JSON.stringify(seededAssignmentPath)}];
if(serveMode && fixture.scenario==='failure') fixture.failNextWrite=true;
const changed=()=>window.dispatchEvent(new CustomEvent('fixture-change'));
if(serveMode){window.alert=(message)=>{fixture.alerts.push(String(message));changed();};changed();}
export const config={year:'2026',semester:'2'};
export const db={};
export const useAuth=()=>({config,userData:{uid:'teacher-fixture',role:'teacher',name:'검증교사'}});
const ref=(...parts)=>({path:parts.filter(p=>typeof p==='string').join('/')});
export const collection=(_db,...parts)=>ref(...parts);
export const doc=(_db,...parts)=>ref(...parts);
export const query=(reference)=>reference;
export const orderBy=()=>null;
export const limit=()=>null;
export const serverTimestamp=()=>({seconds:1790676000,nanoseconds:0});
const snap=(key,value)=>({id:key.split('/').at(-1),exists:()=>value!==undefined,data:()=>structuredClone(value)});
export const getDoc=async(reference)=>{fixture.reads.push(reference.path);return snap(reference.path,fixture.store[reference.path]);};
export const getDocs=async(reference)=>{fixture.reads.push(reference.path);const docs=Object.entries(fixture.store).filter(([key])=>key.startsWith(reference.path+'/')&&!key.slice(reference.path.length+1).includes('/')).map(([key,value])=>snap(key,value));return {docs,empty:!docs.length,size:docs.length};};
export const getDocFromServer=getDoc;
export const getDocsFromServer=getDocs;
export const setDoc=async(reference,payload,options)=>{
 const data=structuredClone(payload);fixture.writes.push({path:reference.path,data,options});changed();
 if(fixture.pauseWrite){fixture.pauseWrite=false;await new Promise(resolve=>fixture.releaseWrite=resolve);}
 if(fixture.failNextWrite){fixture.failNextWrite=false;fixture.failedWrites.push({path:reference.path,data});changed();throw new Error('Expected fixture write failure');}
 if(options?.mergeFields){fixture.store[reference.path]={...(fixture.store[reference.path]||{}),...Object.fromEntries(options.mergeFields.map(key=>[key,data[key]]))};}
 else if(options?.merge){const previous=fixture.store[reference.path]||{};fixture.store[reference.path]={...previous,...data,retryResetByStudentUid:{...previous.retryResetByStudentUid,...data.retryResetByStudentUid}};}
 else fixture.store[reference.path]=data;
 fixture.successfulWrites.push({path:reference.path,data});changed();
};
export const createManagedNotifications=async(_config,payload)=>{fixture.notifications.push(payload);changed();return [];};
export const getHttpsCallable=()=>{throw new Error('Callable use is outside this fixture');};
export const callStudentDataService=()=>{throw new Error('Roster mutation is outside this fixture');};
export const getAssessmentSemesterId=()=> '2026-2';
export const buildAssessmentDefinitionId=(semesterId,kind,sourceId)=>kind.toLowerCase()+':'+semesterId+':'+sourceId;
export const readAssessmentContentRevision=async()=>0;
export const saveHistoryAssessmentSource=async(_config,sourceId,payload,expectedRevision)=>{
 const commandType='saveHistoryClassroomAssignment';
 const source=structuredClone(payload);for(const key of ['id','contentRevision','createdAt','updatedAt','deletedAt','deletedByUid'])delete source[key];
 const commandPayload={semesterId:'2026-2',sourceId,source,expectedRevision,reason:'교사 역사교실 과제 저장'};
 fixture.commands.push({commandType,payload:commandPayload});changed();
 try {
 const reference={path:${JSON.stringify(scope)}+'/history_classrooms/'+sourceId};
 const fields=Object.keys(payload).filter(key=>key!=='retryResetByStudentUid');
 await setDoc(reference,payload,{mergeFields:fields});
 fixture.store[reference.path].contentRevision=expectedRevision+1;
 const asIso=value=>value?.seconds!==undefined?new Date(value.seconds*1000).toISOString():typeof value==='string'?value:null;
 const result={contentRevision:expectedRevision+1,publicationWindow:{publishedAt:asIso(payload.publishedAt),dueAt:asIso(payload.dueAt)}};
 fixture.commandResults.push({commandType,payload:commandPayload,result});changed();return result;
 } catch(error) {fixture.failedCommands.push({commandType,payload:commandPayload,code:error?.code||'error',message:String(error?.message||error)});changed();throw error;}
};
export const deleteHistoryAssessmentSource=async()=>{throw new Error('Deletion is outside this fixture');};
export const executeAssessmentManagementCommand=async(commandType,payload)=>{
 fixture.commands.push({commandType,payload:structuredClone(payload)});changed();
 const completed=result=>{fixture.commandResults.push({commandType,payload:structuredClone(payload),result:structuredClone(result)});changed();return result;};
 try {
 if(commandType==='resetAssessmentAttempt'){
  const id=payload.definitionId.split(':').at(-1);
  const key=Object.keys(fixture.store).find(key=>key.endsWith('/history_classrooms/'+id)||key==='history_classrooms/'+id);
  await setDoc({path:key},{retryResetByStudentUid:{[payload.studentUid]:serverTimestamp()},updatedAt:serverTimestamp()},{merge:true});
  return completed({});
 }
 if(commandType==='grantHistoryClassroomExemptions') {
  if(fixture.pauseGrant){fixture.pauseGrant=false;await new Promise(resolve=>fixture.releaseGrant=resolve);}
  if(fixture.failNextGrant){fixture.failNextGrant=false;throw Object.assign(new Error('INTERNAL'),{code:'functions/internal'});}
  return completed({createdCount:payload.recipientUids.length,exemptionIds:payload.recipientUids.map(uid=>'exemption-'+uid)});
 }
 if(commandType==='applyHistoryClassroomExemption') {
  if(fixture.pauseExemption){fixture.pauseExemption=false;await new Promise(resolve=>{fixture.releaseExemption=()=>{delete fixture.releaseExemption;changed();resolve();};changed();});}
  const fail=message=>{throw Object.assign(new Error(message),{code:'functions/failed-precondition'});};
  if(fixture.failNextExemption){fixture.failNextExemption=false;throw Object.assign(new Error('합성 면제 처리 오류입니다. 다시 시도해 주세요.'),{code:'functions/unavailable'});}
  const sourcePath=${JSON.stringify(scope)}+'/history_classrooms/'+payload.assignmentId;
  const ticketPath=${JSON.stringify(scope)}+'/history_classroom_exemptions/'+payload.exemptionId;
  const source=fixture.store[sourcePath],ticket=fixture.store[ticketPath];
  if(!source?.isPublished||!source.targetStudentUids?.includes(payload.studentUid))fail('공개된 과제에 배정된 학생만 면제할 수 있습니다.');
  if(!ticket||ticket.uid!==payload.studentUid||!['available','active'].includes(ticket.status)||ticket.usedAt||ticket.usedAssignmentId||ticket.usedByUid||['used','consumed','requested','pending','revoked'].includes(ticket.state))fail('사용 가능한 면제권이 없습니다.');
  if(ticket.assignmentId&&ticket.assignmentId!==payload.assignmentId)fail('이 과제에서 사용할 수 없는 면제권입니다.');
  if(Object.entries(fixture.store).some(([key,value])=>key.includes('/history_classroom_exemption_requests/')&&value.uid===payload.studentUid&&value.assignmentId===payload.assignmentId&&['pending','requested'].includes(value.status)))fail('대기 중인 면제권 사용 요청을 먼저 검토해 주세요.');
  if(Object.entries(fixture.store).some(([key,value])=>key.includes('/history_classroom_results/')&&value.uid===payload.studentUid&&value.assignmentId===payload.assignmentId&&(value.passed||value.completionSource==='exemption')))fail('이미 통과하거나 면제된 과제입니다.');
  const resultId='synthetic-direct-exemption-'+payload.assignmentId+'-'+payload.studentUid;
  const resultPath=${JSON.stringify(scope)}+'/history_classroom_results/'+resultId;
  const requestId='synthetic-direct-request-'+payload.assignmentId+'-'+payload.studentUid;
  const timestamp=serverTimestamp();
  const result={resultId,definitionId:'history_classroom:'+payload.semesterId+':'+payload.assignmentId,semesterId:payload.semesterId,assignmentId:payload.assignmentId,assignmentTitle:source.title,uid:payload.studentUid,studentUid:payload.studentUid,studentName:ticket.studentName,studentGrade:'3',studentClass:'2',studentNumber:ticket.studentNumber,status:'passed',passed:true,score:source.blanks.length,total:source.blanks.length,percent:100,passThresholdPercent:source.passThresholdPercent,completionSource:'exemption',exemptionId:payload.exemptionId,exemptionRequestId:requestId,origin:'teacher_direct',initiatedByUid:'teacher-fixture',approvedByUid:'teacher-fixture',approvedAt:timestamp,createdAt:timestamp,updatedAt:timestamp,answers:{},answerChecks:[],reward:{status:'NOT_ELIGIBLE',awarded:false,totalAwarded:0}};
  fixture.store[ticketPath]={...ticket,status:'used',usedAssignmentId:payload.assignmentId,usedByUid:payload.studentUid,usedAt:timestamp,origin:'teacher_direct',initiatedByUid:'teacher-fixture',exemptionRequestId:requestId};
  fixture.store[resultPath]=result;
  fixture.store['semester_assessment_results/'+resultId]=structuredClone(result);
  fixture.store[${JSON.stringify(scope)}+'/history_classroom_exemption_requests/'+requestId]={...result,status:'approved',reviewedByUid:'teacher-fixture',reviewedAt:timestamp};
  return completed({studentUid:payload.studentUid,assignmentId:payload.assignmentId,exemptionId:payload.exemptionId,resultId,status:'approved',origin:'teacher_direct'});
 }
 throw new Error('Unexpected command '+commandType);
 } catch(error) {fixture.failedCommands.push({commandType,payload:structuredClone(payload),code:error?.code||'error',message:String(error?.message||error)});changed();throw error;}
};
export const executeStudentAssessmentCommand=async()=>{throw new Error('Student mutation is outside this teacher fixture');};
`;
const component = JSON.stringify(
  path
    .join(root, "src/pages/teacher/ManageHistoryClassroom.tsx")
    .replaceAll("\\", "/"),
);
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import Manage from ${component};const root=createRoot(document.getElementById('root'));let revision=0;window.__remount=()=>root.render(<MemoryRouter key={++revision}><Manage/></MemoryRouter>);window.__remount();`,
    loader: "tsx",
    resolveDir: root,
  },
  bundle: true,
  outfile: "fixture.js",
  write: false,
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  plugins: [
    {
      name: "in-memory-boundaries",
      setup(build) {
        build.onResolve(
          {
            filter:
              /^firebase\/firestore$|(?:lib\/|^\.\/)(?:firebase|notifications|assessmentLifecycle|assessmentRelease|studentProfileCommands)$|contexts\/AuthContext$/,
          },
          () => ({ path: "fixture-boundaries", namespace: "fixture" }),
        );
        build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: mock,
          loader: "js",
        }));
      },
    },
  ],
});
const css = (
  await Promise.all(
    [
      "assets/css/style.css",
      "src/assets/index.css",
      "src/components/common/portalPage.css",
    ].map((file) =>
      fs.readFile(path.join(root, file), "utf8"),
    ),
  )
)
  .concat(bundle.outputFiles.filter((file) => file.path.endsWith(".css")).map((file) => file.text))
  .join("\n")
  .replaceAll(/@import[^;]+;/g, "")
  .replaceAll(/@tailwind[^;]+;/g, "");
const fixtureShellCss = `
#fixture-shell{display:grid;grid-template-columns:224px minmax(0,1fr);min-height:100dvh}
#fixture-sidebar{width:224px;box-sizing:border-box;padding:24px 16px;background:#fff;border-right:1px solid #e2e8f0;position:sticky;top:0;height:100dvh}
#fixture-sidebar strong{display:block;color:#2563eb;font-size:24px;margin-bottom:24px}
#fixture-sidebar p{margin:16px 0;color:#475569;font-size:14px}
#fixture-sidebar [aria-current]{padding:12px;border-radius:8px;background:#eff6ff;color:#2563eb}
#fixture-main{min-width:0}
#fixture-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;background:#fff;border-bottom:1px solid #e2e8f0;font-size:12px}
#fixture-toolbar nav{display:flex;flex-wrap:wrap;gap:4px}
#fixture-toolbar a,#fixture-toolbar button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;text-decoration:none}
#fixture-toolbar a[aria-current]{background:#eff6ff;color:#2563eb;border-color:#2563eb}
#fixture-toolbar button:focus-visible,#fixture-toolbar a:focus-visible,#fixture-records summary:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
#fixture-release-exemption:not(:disabled){position:fixed;right:12px;bottom:12px;z-index:2147483600;max-width:calc(100vw - 24px);background:#1d4ed8;color:#fff;border-color:#1d4ed8;box-shadow:0 4px 18px #0003}
#fixture-status{flex-basis:100%;overflow-wrap:anywhere;color:#475569}
#fixture-records{margin:16px;padding:12px;background:#fff;border:1px solid #cbd5e1;border-radius:8px;min-width:0}
#fixture-records summary{min-height:44px;cursor:pointer;font-weight:700;color:#334155}
#fixture-records p{font-size:12px;color:#475569}
#fixture-records pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:480px;overflow:auto}
@media(max-width:768px){#fixture-shell{grid-template-columns:minmax(0,1fr)}#fixture-sidebar{display:none}}
`;
const fixtureControls = `
<div id="fixture-toolbar" aria-label="합성 QA 도구">
  <strong>합성 QA</strong>
  <nav aria-label="QA 시나리오">
    <a href="/?scenario=dashboard" data-scenario="dashboard">대시보드</a>
    <a href="/?scenario=new" data-scenario="new">신규 등록</a>
    <a href="/?scenario=failure" data-scenario="failure">저장 실패·재시도</a>
    <a href="/?scenario=edit" data-scenario="edit">편집</a>
    <a href="/?scenario=attempts" data-scenario="attempts">응시 현황 34명</a>
    <a href="/?scenario=ticket" data-scenario="ticket">면제권 보유</a>
    <a href="/?scenario=no-ticket" data-scenario="no-ticket">면제권 없음</a>
    <a href="/?scenario=exempted" data-scenario="exempted">면제 완료</a>
    <a href="/?scenario=exemption-failure" data-scenario="exemption-failure">면제 실패·재시도</a>
  </nav>
  <button type="button" id="fixture-fail-once">다음 저장 1회 실패</button>
  <button type="button" id="fixture-fail-exemption-once">다음 면제 1회 실패</button>
  <button type="button" id="fixture-pause-exemption">다음 면제 처리 대기</button>
  <button type="button" id="fixture-release-exemption" disabled>대기 처리 완료</button>
  <button type="button" id="fixture-clear-records">QA 기록 지우기</button>
  <span id="fixture-status" role="status" aria-live="polite"></span>
</div>`;
const fixtureRecords = `<details id="fixture-records"><summary id="fixture-records-summary">QA 기록</summary><p>저장과 알림은 이 페이지 메모리에만 기록됩니다. 새로고침하면 초기화됩니다.</p><pre id="fixture-records-json" aria-label="QA 저장 payload와 처리 기록"></pre></details>`;
const fixtureUiScript = `
const updateFixtureRecords=()=>{
 const fixture=window.__fixture;if(!fixture)return;
 const rows=Object.entries(fixture.store);
 const exemptions=rows.filter(([key])=>key.includes('/history_classroom_exemptions/')).map(([path,data])=>({path,...data}));
 const results=rows.filter(([key])=>key.includes('/history_classroom_results/')).map(([path,data])=>({path,...data}));
 const requests=rows.filter(([key])=>key.includes('/history_classroom_exemption_requests/')).map(([path,data])=>({path,...data}));
 const data={scenario:fixture.scenario,writeAttempts:fixture.writes.length,successfulWrites:fixture.successfulWrites.length,failedWrites:fixture.failedWrites.length,commandAttempts:fixture.commands.length,sourceSaveCommands:fixture.commands.filter(item=>item.commandType==='saveHistoryClassroomAssignment').length,directExemptionCommands:fixture.commands.filter(item=>item.commandType==='applyHistoryClassroomExemption').length,successfulCommands:fixture.commandResults.length,failedCommands:fixture.failedCommands.length,notifications:fixture.notifications.length,notificationRecipients:fixture.notifications.reduce((sum,item)=>sum+(item.recipientUids?.length||0),0),failNextWrite:!!fixture.failNextWrite,failNextExemption:!!fixture.failNextExemption,pauseExemption:!!fixture.pauseExemption,exemptionWaiting:!!fixture.releaseExemption,lastWritePath:fixture.writes.at(-1)?.path||null,payload:fixture.writes.at(-1)?.data||null,writes:fixture.writes,notificationPayloads:fixture.notifications,alerts:fixture.alerts,commands:fixture.commands,commandResults:fixture.commandResults,commandFailures:fixture.failedCommands,exemptions,results,requests};
 document.getElementById('fixture-records-summary').textContent='QA 기록 · 저장 '+data.writeAttempts+'회 · 명령 '+data.commandAttempts+'회 / 성공 '+data.successfulCommands+' / 실패 '+data.failedCommands+' · 알림 '+data.notifications+'회';
 document.getElementById('fixture-records-json').textContent=JSON.stringify(data,null,2);
 const attemptScenario=['attempts','ticket','no-ticket','exempted','exemption-failure'].includes(fixture.scenario);
 const hint=['new','failure'].includes(fixture.scenario)?'앱의 새 역사교실 버튼으로 등록을 시작하세요.':attemptScenario?'합성 학생 34명 배정. 01번: '+(fixture.scenario==='no-ticket'?'면제권 없음':fixture.scenario==='exempted'?'면제 완료':'면제권 보유')+' · 02번: 면제권 없음 · 03번: 면제 완료 · 04번: 면제권 보유 · 05번: 미통과 · 06번: 통과 · 07번: 면제 요청 대기(별도 보유권도 있음). 앱의 행 수정 버튼으로 응시 현황을 확인하세요.':'긴 제목 과제 1개 · 합성 학생 34명 · 배정 24명. 앱의 행 수정 버튼으로 편집하세요.';
 document.getElementById('fixture-status').textContent=(fixture.failNextWrite?'다음 저장 1회 실패. ':'')+(fixture.failNextExemption?'다음 면제 1회 실패. ':'')+(fixture.pauseExemption?'다음 면제는 완료 버튼을 누를 때까지 대기합니다. ':'')+(fixture.releaseExemption?'면제 명령 대기 중. ':'')+hint+(fixture.alerts.length?' 최근 메시지: '+fixture.alerts.at(-1):'');
 document.getElementById('fixture-release-exemption').disabled=!fixture.releaseExemption;
 document.querySelectorAll('[data-scenario]').forEach(link=>{if(link.dataset.scenario===fixture.scenario)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
};
window.addEventListener('fixture-change',updateFixtureRecords);
document.getElementById('fixture-fail-once').addEventListener('click',()=>{if(window.__fixture){window.__fixture.failNextWrite=true;updateFixtureRecords();}});
document.getElementById('fixture-fail-exemption-once').addEventListener('click',()=>{if(window.__fixture){window.__fixture.failNextExemption=true;updateFixtureRecords();}});
document.getElementById('fixture-pause-exemption').addEventListener('click',()=>{if(window.__fixture){window.__fixture.pauseExemption=true;updateFixtureRecords();}});
document.getElementById('fixture-release-exemption').addEventListener('click',()=>{window.__fixture?.releaseExemption?.();updateFixtureRecords();});
document.getElementById('fixture-clear-records').addEventListener('click',()=>{const fixture=window.__fixture;if(!fixture)return;for(const key of ['writes','successfulWrites','failedWrites','notifications','alerts','commands','commandResults','failedCommands'])fixture[key].length=0;updateFixtureRecords();});
`;
const fixtureBody = serveOnly
  ? `<div id="fixture-shell"><aside id="fixture-sidebar" aria-label="합성 교사 사이드바"><strong>Westory</strong><p>교사 포털 · 합성 화면</p><p>대시보드</p><p>수업 관리</p><p aria-current="page">역사교실</p><p>학생 관리</p><p>설정</p><p>가로 폭 224px</p></aside><div id="fixture-main">${fixtureControls}<div id="root"></div>${fixtureRecords}</div></div><script>${fixtureUiScript}</script>`
  : '<div id="root"></div>';
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>역사교실 합성 QA</title><script src="/tailwind.js"></script><style>${css}body{margin:0}#root{min-width:0}${serveOnly ? fixtureShellCss : ""}</style>${fixtureBody}<script type="module" src="/fixture.js"></script></html>`;
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400"><rect width="1000" height="1400" fill="white"/><text x="100" y="100" font-size="36">교사 자료 검증</text></svg>';
const server = http.createServer((req, res) => {
  const route = req.url.split("?")[0];
  res.setHeader("Cache-Control", "no-store");
  // Block external fonts, images, frames and network calls in server-only QA.
  // Tailwind's local browser compiler requires inline styles/scripts and eval.
  if (serveOnly) res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' blob:");
  res.setHeader(
    "Content-Type",
    route.endsWith(".js")
      ? "text/javascript"
      : route.endsWith(".svg")
        ? "image/svg+xml"
        : "text/html;charset=utf-8",
  );
  res.end(
    route === "/fixture.js"
      ? bundle.outputFiles.find((file) => file.path.endsWith(".js")).text
      : route === "/tailwind.js"
        ? tailwind
        : route === "/worksheet.svg"
          ? svg
          : html,
  );
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(serveOnly ? servePort : 0, "127.0.0.1", resolve);
});
if (serveOnly) {
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`History Classroom fixture ready (HTTP server only; synthetic data; external requests blocked): ${base}/?scenario=dashboard`);
  console.log(`Scenarios: ${['new','failure','edit','attempts','ticket','no-ticket','exempted','exemption-failure'].map(scenario => base + '/?scenario=' + scenario).join(' | ')}`);
  console.log("Use the app's new/edit controls; inspect the QA records panel for payloads and synthetic write/notification counts. Restart this server after source changes.");
  await new Promise((resolve) => {
    const stop = () => { server.closeAllConnections(); server.close(resolve); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  process.exit(0);
}
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const reports = [];
const expectedBlanks = originalBlanks.map((b) => ({
  id: b.id,
  page: b.page,
  left: b.leftRatio * 1000,
  top: b.topRatio * 1400,
  width: b.widthRatio * 1000,
  height: b.heightRatio * 1400,
  answer: b.answer,
  prompt: b.prompt,
  source: b.source,
}));
const snapshotFields = (assignment) =>
  Object.fromEntries(
    [
      "sourceType",
      "lessonUnitId",
      "lessonTitle",
      "lessonUnitPath",
      "mapResourceId",
      "mapTitle",
      "pdfPageImages",
      "pdfRegions",
      "blanks",
      "answerOptions",
    ].map((key) => [key, assignment[key]]),
  );
const waitWrite = async (page, count) => {
  await page.waitForFunction(
    (count) => window.__fixture.writes.length === count,
    count,
  );
  return page.evaluate(() => window.__fixture.writes.at(-1));
};
const measure = async (page, id) =>
  page.locator(id).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      right: r.right,
      width: r.width,
      height: r.height,
      viewport: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      label: el.selectedOptions[0]?.textContent,
    };
  });
const assertNewDefaults = async (page) => {
  assert.deepEqual(
    await page
      .locator('input[type="number"]')
      .evaluateAll((inputs) => inputs.map((input) => input.value)),
    ["10", "5", "", "90"],
  );
  assert.equal(
    await page.getByLabel("대상 학년", { exact: true }).inputValue(),
    "3",
  );
  assert.equal(
    await page.getByLabel("대상 학급", { exact: true }).inputValue(),
    "2",
  );
};
const assignmentReasons = [
  "1인 1역 및 청소 안함",
  "지각",
  "수업 태도",
  "교사 지시 불이행",
];
const assertReasonCombobox = async (page, input, blurTarget) => {
  const originalValue = await input.inputValue();
  assert.equal(await input.getAttribute("role"), "combobox");
  assert.equal(await input.getAttribute("aria-autocomplete"), "list");
  assert.equal(await input.getAttribute("list"), null);
  await input.click();
  assert.equal(await input.getAttribute("aria-expanded"), "true");
  const listId = await input.getAttribute("aria-controls");
  assert(listId, "an open reason field identifies its own listbox");
  const list = page.locator(`[id="${listId}"]`);
  assert.equal(await list.getAttribute("role"), "listbox");
  assert.deepEqual(await list.getByRole("option").allTextContents(), assignmentReasons);
  const geometry = await input.evaluate((element) => {
    const anchor = element.getBoundingClientRect();
    const options = document.getElementById(element.getAttribute("aria-controls")).getBoundingClientRect();
    return {
      anchor: { left: anchor.left, right: anchor.right, top: anchor.top, bottom: anchor.bottom, width: anchor.width },
      options: { left: options.left, right: options.right, top: options.top, bottom: options.bottom, width: options.width },
      viewport: innerWidth,
    };
  });
  assert(
    Math.abs(geometry.anchor.left - geometry.options.left) <= 1 &&
      Math.abs(geometry.anchor.right - geometry.options.right) <= 1 &&
      Math.abs(geometry.anchor.width - geometry.options.width) <= 1 &&
      ((geometry.options.top >= geometry.anchor.bottom && geometry.options.top <= geometry.anchor.bottom + 8) ||
        (geometry.options.bottom <= geometry.anchor.top && geometry.options.bottom >= geometry.anchor.top - 8)) &&
      geometry.options.left >= 0 && geometry.options.right <= geometry.viewport,
    `reason options stay attached above or below their field at the same width: ${JSON.stringify(geometry)}`,
  );
  await input.press("ArrowDown");
  let activeId = await input.getAttribute("aria-activedescendant");
  assert.equal(await page.locator(`[id="${activeId}"]`).textContent(), assignmentReasons[0]);
  await input.press("ArrowDown");
  activeId = await input.getAttribute("aria-activedescendant");
  assert.equal(await page.locator(`[id="${activeId}"]`).textContent(), assignmentReasons[1]);
  await input.press("Enter");
  assert.equal(await input.inputValue(), assignmentReasons[1]);
  assert.equal(await input.getAttribute("aria-expanded"), "false");
  assert.equal(await list.count(), 0, "keyboard selection closes the reason list");
  assert(await input.evaluate((element) => document.activeElement === element));
  const composingKey = await input.evaluate((element) => {
    const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true, isComposing: true });
    element.dispatchEvent(event);
    return { prevented: event.defaultPrevented, expanded: element.getAttribute("aria-expanded") };
  });
  assert.deepEqual(composingKey, { prevented: false, expanded: "false" }, "Korean composition keys do not open or select reason presets");
  await input.click();
  await input.press("ArrowDown");
  await input.press("Escape");
  assert.equal(await input.getAttribute("aria-expanded"), "false");
  assert.equal(await list.count(), 0);
  assert(await input.evaluate((element) => document.activeElement === element && !!element.closest('[role="dialog"]')),
    "Escape closes only the reason list and keeps the dialog input focused");
  await input.click();
  await list.getByRole("option", { name: assignmentReasons[3], exact: true }).click();
  assert.equal(await input.inputValue(), assignmentReasons[3]);
  assert.equal(await input.getAttribute("aria-expanded"), "false");
  assert.equal(await list.count(), 0, "pointer selection closes the reason list");
  assert(await input.evaluate((element) => document.activeElement === element));
  await input.click();
  assert.equal(await list.count(), 1);
  await blurTarget.focus();
  assert.equal(await input.getAttribute("aria-expanded"), "false");
  assert.equal(await list.count(), 0, "moving focus outside the field closes its list");
  await input.fill(originalValue);
  if (await input.getAttribute("aria-expanded") === "true") {
    await input.press("Escape");
  }
  await blurTarget.focus();
  return geometry;
};
const assertAttemptColumnAlignment = async (panel) => {
  const geometry = await panel.locator(".history-attempt-table").evaluate((table) => {
    const headers = [...table.querySelectorAll("thead th")].map((header) => {
      const box = header.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(header);
      const text = range.getBoundingClientRect();
      return { label: header.textContent, left: box.left, right: box.right, center: box.left + box.width / 2, textCenter: text.left + text.width / 2 };
    });
    const rows = [...table.querySelectorAll(".history-attempt-row")].map((row) => ({
      label: row.getAttribute("aria-label"),
      cells: [...row.children].map((cell) => {
        const box = cell.getBoundingClientRect();
        const visibleContents = [...cell.children]
          .filter((child) => getComputedStyle(child).position !== "absolute")
          .map((child) => child.getBoundingClientRect())
          .filter((child) => child.width > 0 && child.height > 0);
        const contentLeft = visibleContents.length ? Math.min(...visibleContents.map((child) => child.left)) : null;
        const contentRight = visibleContents.length ? Math.max(...visibleContents.map((child) => child.right)) : null;
        return { left: box.left, right: box.right, center: box.left + box.width / 2, contentCenter: contentLeft === null ? null : (contentLeft + contentRight) / 2 };
      }),
    }));
    return { headers, rows };
  });
  assert.equal(geometry.headers.length, 3);
  for (const header of geometry.headers) {
    assert(Math.abs(header.textCenter - header.center) <= 1,
      `${header.label} header is centered in its column: ${JSON.stringify(header)}`);
  }
  for (const row of geometry.rows) {
    assert.equal(row.cells.length, geometry.headers.length);
    row.cells.forEach((cell, index) => {
      const header = geometry.headers[index];
      assert(
        Math.abs(cell.left - header.left) <= 1 &&
          Math.abs(cell.right - header.right) <= 1 &&
          Math.abs(cell.center - header.center) <= 1 &&
          (cell.contentCenter === null || Math.abs(cell.contentCenter - header.center) <= 1),
        `${row.label} ${header.label} content shares its header's width and center: ${JSON.stringify({ header, cell })}`,
      );
    });
  }
  return geometry;
};
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1280, height: 900 },
    { width: 1366, height: 768 },
  ]) {
    const page = await browser.newPage({ viewport, hasTouch: true });
    const errors = [],
      alerts = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error") console.error(message.text());
    });
    page.on("dialog", async (dialog) => {
      alerts.push(dialog.message());
      await dialog.accept();
    });
    await page.route("**/*", (route) =>
      route
        .request()
        .url()
        .startsWith(`http://127.0.0.1:${server.address().port}`)
        ? route.continue()
        : route.abort(),
    );
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page
      .getByRole("button", { name: "새 역사교실", exact: true })
      .click();
    await assertNewDefaults(page);
    assert.equal(
      await page.locator("#history-create-source-type").count(),
      0,
      "New assignments offer only lesson worksheets",
    );
    await page.waitForFunction(
      () =>
        document.querySelectorAll("#history-create-source option").length === 2,
    );
    const options = await page
      .locator("#history-create-source option")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({ value: node.value, label: node.textContent })),
      );
    assert.deepEqual(
      options.map((item) => item.value),
      ["b", "a"],
      "curriculum order must win over alphabetical sorting",
    );
    assert.equal(options[1].label, longTitle);
    assert.deepEqual(
      await page
        .locator("#history-create-source-level-0 option")
        .evaluateAll((nodes) => nodes.map((node) => node.value)),
      ["chapter", "chapter-copy"],
    );
    await page
      .locator("#history-create-source-level-0")
      .selectOption("chapter-copy");
    assert.deepEqual(
      await page
        .locator("#history-create-source option")
        .evaluateAll((nodes) => nodes.map((node) => node.value)),
      ["c"],
    );
    await page
      .locator("#history-create-source-level-0")
      .selectOption("chapter");
    await page
      .locator("#history-create-source-level-1")
      .selectOption("middle-other");
    assert.deepEqual(
      await page
        .locator("#history-create-source option")
        .evaluateAll((nodes) => nodes.map((node) => node.value)),
      ["d"],
    );
    await page.locator("#history-create-source-level-1").selectOption("middle");
    await page.locator("#history-create-source").selectOption("a");
    const geometry = await measure(page, "#history-create-source");
    assert(
      !geometry.overflow &&
        geometry.right <= viewport.width &&
        geometry.left >= 0,
      `source selector stays in the viewport: ${JSON.stringify(geometry)}`,
    );
    assert(
      geometry.height >= 44,
      "source selector has a tablet-sized touch target",
    );
    await page.screenshot({
      path: path.join(evidence, `teacher-create-${viewport.width}.png`),
      fullPage: true,
    });
    assert.equal(
      await page
        .getByRole("button", { name: "지도 관리", exact: true })
        .count(),
      0,
    );
    await page.getByLabel("전체 학생 이름 검색", { exact: true }).fill("검증학생");
    await page.getByRole("button", { name: /검증학생.*3-2/ }).click();
    assert.equal(await page.getByLabel("검증학생 배정 사유", { exact: true }).count(), 0, "A student is not added without a reason");
    await page.getByText("배정 사유를 입력해 주세요.", { exact: true }).waitFor();
    const reasonInput = page.getByLabel("추가할 학생 배정 사유", { exact: true });
    const reasonGeometry = await assertReasonCombobox(page, reasonInput,
      page.getByLabel("전체 학생 이름 검색", { exact: true }));
    await reasonInput.fill("   ");
    await page.getByRole("button", { name: /검증학생.*3-2/ }).click();
    assert.equal(
      await page.evaluate(() => window.__fixture.writes.length),
      0,
      "Whitespace does not satisfy the required reason",
    );
    assert(
      await page
        .getByText("배정 사유를 입력해 주세요.", { exact: true })
        .isVisible(),
    );
    await page.screenshot({
      path: path.join(
        evidence,
        `teacher-create-reason-required-${viewport.width}.png`,
      ),
      fullPage: true,
    });
    await reasonInput.fill("교사가 작성한 세부 사유");
    assert.equal(await reasonInput.inputValue(), "교사가 작성한 세부 사유");
    await reasonInput.fill("지각");
    assert.equal(
      await page.getByLabel("추가할 학생 기타 사유", { exact: true }).count(),
      0,
      "Preset and custom reasons share the same input",
    );
    await page.getByRole("button", { name: /검증학생.*3-2/ }).click();
    const assignedReason = page.getByLabel("검증학생 배정 사유", { exact: true });
    assert.equal(await assignedReason.inputValue(), "지각");
    const assignedReasonGeometry = await assertReasonCombobox(page, assignedReason,
      page.getByLabel("전체 학생 이름 검색", { exact: true }));
    await assignedReason.fill("같은 행에서 직접 수정한 사유");
    assert.equal(await assignedReason.inputValue(), "같은 행에서 직접 수정한 사유");
    await assignedReason.fill("지각");
    await page
      .getByRole("button", { name: "역사교실 저장", exact: true })
      .click();
    const created = await waitWrite(page, 1);
    assert(created.path.startsWith(`${scope}/history_classrooms/`));
    assert.equal(created.data.sourceType, "lesson");
    assert.equal(created.data.lessonUnitId, "a");
    assert.deepEqual(created.data.lessonUnitPath, [
      "II. 고대 사회",
      "국가의 형성",
      longTitle,
    ]);
    assert.deepEqual(
      created.data.blanks,
      expectedBlanks,
      "saved blanks keep ids, answer, prompt, source, page and exact geometry",
    );
    assert.deepEqual(created.data.pdfPageImages, pageImages);
    assert.equal(created.data.mapResourceId, "");
    assert.deepEqual(created.data.targetStudentUids, ["student-1"]);
    assert.equal(created.data.targetStudentReasons["student-1"], "지각");
    assert.deepEqual(
      [
        created.data.timeLimitMinutes,
        created.data.cooldownMinutes,
        created.data.passThresholdPercent,
        created.data.targetGrade,
        created.data.targetClass,
      ],
      [10, 5, 90, "3", "2"],
    );
    const dashboardCard = page.locator(".history-dashboard article").first();
    await dashboardCard.waitFor();
    const dashboardGeometry = await page.locator(".history-dashboard").filter({ has: page.locator(".history-timeline-marker") }).evaluate((dashboard) => {
      const marker = dashboard.querySelector(".history-timeline-marker").getBoundingClientRect();
      const dashboardBox = dashboard.getBoundingClientRect();
      const line = getComputedStyle(dashboard, "::before");
      const status = dashboard.querySelector(".history-card-status");
      const controls = [...status.querySelectorAll(".history-card-control")].map((control) => {
        const box = control.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width, height: box.height, centerY: box.top + box.height / 2 };
      });
      return {
        markerCenterX: marker.left + marker.width / 2,
        lineCenterX: dashboardBox.left + parseFloat(line.left) + parseFloat(line.width) / 2,
        statusOverflow: status.scrollWidth > status.clientWidth + 1,
        controls,
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    assert(
      Math.abs(dashboardGeometry.markerCenterX - dashboardGeometry.lineCenterX) <= 1,
      `date marker stays on the timeline: ${JSON.stringify(dashboardGeometry)}`,
    );
    assert(
      dashboardGeometry.controls.every((control) => control.width >= 44 && control.height >= 44 && control.left >= 0 && control.right <= viewport.width),
      "dashboard edit and accordion controls remain reachable at 44px",
    );
    assert(
      Math.abs(dashboardGeometry.controls[0].centerY - dashboardGeometry.controls[1].centerY) <= 1 && !dashboardGeometry.statusOverflow && !dashboardGeometry.pageOverflow,
      `edit and accordion stay on the same row without overflow: ${JSON.stringify(dashboardGeometry)}`,
    );
    await dashboardCard.getByRole("button", { name: "상세 펼치기", exact: true }).click();
    assert.equal(await dashboardCard.getByRole("button", { name: "상세 접기", exact: true }).getAttribute("aria-expanded"), "true");
    await page.screenshot({
      path: path.join(evidence, `teacher-dashboard-${viewport.width}.png`),
      fullPage: true,
    });
    await dashboardCard.getByRole("button", { name: "상세 접기", exact: true }).click();
    await page
      .getByRole("button", { name: "새 역사교실", exact: true })
      .click();
    await assertNewDefaults(page);
    await page.locator('input[type="number"]').first().fill("17");
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await page
      .getByRole("button", { name: "새 역사교실", exact: true })
      .click();
    await assertNewDefaults(page);
    await page.getByRole("button", { name: "닫기", exact: true }).click();

    // Reload the actual teacher component after the source lesson changes.
    // Existing assignments must keep their published snapshot on a settings save.
    await page.evaluate(
      ({ scope }) => {
        window.__fixture.store[`${scope}/lessons/a`].worksheetBlanks[0].answer =
          "원본에서 수정된 정답";
        window.__fixture.store[
          `${scope}/lessons/a`
        ].worksheetPageImages[0].imageUrl = "/worksheet.svg?revision=2";
        const assignment = Object.entries(window.__fixture.store).find(
          ([key]) => key.startsWith(`${scope}/history_classrooms/`),
        )[1];
        assignment.timeLimitMinutes = 17;
        assignment.cooldownMinutes = 8;
        assignment.passThresholdPercent = 75;
        window.__remount();
      },
      { scope },
    );
    await page
      .getByRole("button", { name: `${longTitle} 설정 수정`, exact: true })
      .click();
    assert.equal(await page.locator("#history-edit-source-type").count(), 0);
    assert.equal(await page.locator("#history-edit-source").inputValue(), "a");
    await page.locator("#history-edit-source").scrollIntoViewIfNeeded();
    const editGeometry = await measure(page, "#history-edit-source");
    await page.screenshot({
      path: path.join(evidence, `teacher-edit-${viewport.width}.png`),
      fullPage: true,
    });
    assert(
      !editGeometry.overflow &&
        editGeometry.right <= viewport.width &&
        editGeometry.left >= 0,
      `edit selector fits: ${JSON.stringify(editGeometry)}`,
    );
    assert.deepEqual(
      await page
        .locator('input[type="number"]')
        .evaluateAll((inputs) => inputs.map((input) => input.value)),
      ["17", "8", "", "75"],
      "Editing keeps existing policy instead of new assignment defaults",
    );
    assert.equal(
      await page.getByLabel("검증학생 배정 사유", { exact: true }).inputValue(),
      "지각",
    );
    const editReasonGeometry = await assertReasonCombobox(page,
      page.getByLabel("검증학생 배정 사유", { exact: true }),
      page.locator('input[type="number"]').first());
    await page
      .getByLabel("검증학생 배정 사유", { exact: true })
      .fill("");
    await page.getByRole("button", { name: "설정 저장", exact: true }).click();
    assert.equal(
      await page.evaluate(() => window.__fixture.writes.length),
      1,
      "An edited reason cannot be cleared",
    );
    await page.screenshot({
      path: path.join(
        evidence,
        `teacher-edit-other-required-${viewport.width}.png`,
      ),
      fullPage: true,
    });
    await page
      .getByLabel("검증학생 배정 사유", { exact: true })
      .fill("기존 자유 입력 사유를 유지합니다");
    await page.getByRole("button", { name: "설정 저장", exact: true }).click();
    const preserved = await waitWrite(page, 2);
    assert.deepEqual(
      [
        preserved.data.timeLimitMinutes,
        preserved.data.cooldownMinutes,
        preserved.data.passThresholdPercent,
      ],
      [17, 8, 75],
    );
    assert.equal(
      preserved.data.targetStudentReasons["student-1"],
      "기존 자유 입력 사유를 유지합니다",
    );
    assert.deepEqual(
      snapshotFields(preserved.data),
      snapshotFields(created.data),
      "unchanged source preserves the original assignment snapshot",
    );

    // A pre-existing map assignment keeps its own pages and blanks even when
    // its old live map changes. OCR regions were optional in production.
    await page.evaluate(
      ({ assignmentPath, map, scope }) => {
        Object.assign(window.__fixture.store[assignmentPath], {
          sourceType: "map",
          title: map.title,
          mapTitle: map.title,
          mapResourceId: "map-1",
          lessonUnitId: "",
          lessonTitle: "",
          lessonUnitPath: [],
          pdfPageImages: map.pdfPageImages,
          pdfRegions: [],
          blanks: map.pdfBlanks,
          answerOptions: map.pdfBlanks.map((blank) => blank.answer),
          targetStudentReasons: {},
        });
        window.__fixture.store[`${scope}/map_resources/map-1`].pdfBlanks = [];
        window.__remount();
      },
      { assignmentPath: created.path, map, scope },
    );
    await page
      .getByRole("button", { name: "한반도 지도 설정 수정", exact: true })
      .click();
    assert.equal(
      await page.getByLabel("검증학생 배정 사유", { exact: true }).inputValue(),
      "",
      "An untouched legacy assignment may have no saved reason",
    );
    assert.equal(await page.locator("#history-edit-source-type").count(), 0);
    await page.getByRole("button", { name: "설정 저장", exact: true }).click();
    const mapped = await waitWrite(page, 3);
    assert.equal(
      mapped.data.targetStudentReasons["student-1"] || "",
      "",
      "Untouched legacy reasons remain allowed for compatibility",
    );
    assert.equal(mapped.data.sourceType, "map");
    assert.equal(mapped.data.mapResourceId, "map-1");
    assert.equal(mapped.data.lessonUnitId, "");
    assert.deepEqual(mapped.data.lessonUnitPath, []);
    assert.deepEqual(mapped.data.blanks, map.pdfBlanks);
    assert.deepEqual(mapped.data.pdfPageImages, map.pdfPageImages);
    assert.deepEqual(mapped.data.pdfRegions, []);

    await page
      .getByRole("button", { name: "한반도 지도 설정 수정", exact: true })
      .click();
    await page.locator("#history-edit-source").selectOption("chapter");
    assert.equal(await page.locator("#history-edit-source").inputValue(), "b");
    await page.getByRole("button", { name: "설정 저장", exact: true }).click();
    const changed = await waitWrite(page, 4);
    assert.equal(changed.data.sourceType, "lesson");
    assert.equal(changed.data.lessonUnitId, "b");
    assert.equal(changed.data.mapResourceId, "");
    assert.equal(changed.data.blanks[0].answer, "백제");
    assert.deepEqual(changed.data.lessonUnitPath, [
      "II. 고대 사회",
      "국가의 형성",
      "2. 삼국",
    ]);

    await page.evaluate(
      ({ scope }) => {
        delete window.__fixture.store[`${scope}/lessons/b`];
        window.__remount();
      },
      { scope },
    );
    await page
      .getByRole("button", {
        name: `${changed.data.title} 설정 수정`,
        exact: true,
      })
      .click();
    assert.equal(
      await page.locator("#history-edit-source").inputValue(),
      "",
      "missing source shows a placeholder without replacing the saved snapshot",
    );
    await page.getByRole("button", { name: "설정 저장", exact: true }).click();
    const missingSource = await waitWrite(page, 5);
    assert.deepEqual(
      snapshotFields(missingSource.data),
      snapshotFields(changed.data),
      "removed lesson source does not erase the published snapshot",
    );
    // One row per student, complete submission history, and live reset with no result.
    await page.evaluate(
      ({ scope, assignmentPath }) => {
        const f = window.__fixture;
        const assignment = f.store[assignmentPath];
        assignment.targetStudentUids = ["student-1", "student-2", "student-3"];
        assignment.targetStudentAccessMap = {
          "student-1": true,
          "student-2": true,
          "student-3": true,
        };
        for (const [id, name, number] of [
          ["student-2", "종료학생", "4"],
          ["student-3", "통과학생", "5"],
          ["student-4", "추가학생", "6"],
        ]) {
          f.store["users/" + id] = {
            role: "student",
            name,
            grade: "3",
            class: "2",
            number,
          };
        }
        for (const [id, uid, status, percent, seconds] of [
          ["cancelled", "student-2", "cancelled", 0, 200],
          ["failed", "student-2", "failed", 50, 100],
          ["passed-later-failed", "student-3", "failed", 50, 300],
          ["passed", "student-3", "passed", 100, 100],
        ]) {
          f.store[`${scope}/history_classroom_results/${id}`] = {
            assignmentId: assignmentPath.split("/").at(-1),
            uid,
            status,
            passed: status === "passed",
            percent,
            score: percent / 50,
            total: 2,
            studentName: uid === "student-2" ? "종료학생" : "통과학생",
            createdAt: { seconds, nanoseconds: 0 },
            answers: { "saved-b": "백제" },
            answerChecks: [],
          };
        }
        window.__remount();
      },
      { scope, assignmentPath: created.path },
    );
    await page
      .getByRole("button", {
        name: `${changed.data.title} 설정 수정`,
        exact: true,
      })
      .click();
    const panel = page.getByRole("region", { name: "응시 현황 및 제출 내역" });
    assert.equal(await panel.locator("tr[aria-label]").count(), 3);
    const pending = panel.getByRole("row", {
      name: "검증학생 응시 현황",
      exact: true,
    });
    const cancelled = panel.getByRole("row", {
      name: "종료학생 응시 현황",
      exact: true,
    });
    const passed = panel.getByRole("row", {
      name: "통과학생 응시 현황",
      exact: true,
    });
    assert.equal(
      await passed.getByRole("button", { name: /재응시 제한 리셋$/ }).count(),
      0,
      "any passed result remains completed",
    );
    assert.deepEqual(await panel.getByRole("columnheader").allTextContents(), [
      "학생",
      "응시 결과",
      "관리",
    ]);
    const attemptColumnGeometry = await assertAttemptColumnAlignment(panel);
    for (const row of [pending, cancelled, passed]) {
      const geometry = await row.boundingBox();
      assert(
        geometry.height === 36,
        `compact responsive student row: ${JSON.stringify(geometry)}`,
      );
    }
    for (const row of [pending, cancelled]) {
      const reset = row.getByRole("button", { name: /재응시 제한 리셋$/ });
      const geometry = await reset.evaluate((el) => {
        const hit = el.getBoundingClientRect();
        return { hitHeight: hit.height, borderWidth: parseFloat(getComputedStyle(el).borderTopWidth), nestedControls: el.querySelectorAll("button,input,select").length };
      });
      assert(
        geometry.hitHeight === 28,
        "reset fits the requested 28px dense table control",
      );
      assert(
        geometry.borderWidth > 0 && geometry.nestedControls === 0,
        `reset is one bordered button: ${JSON.stringify(geometry)}`,
      );
    }
    await cancelled.click();
    assert.equal(await cancelled.getAttribute("aria-expanded"), "true");
    await cancelled.focus();
    await cancelled.press("Enter");
    assert.equal(await cancelled.getAttribute("aria-expanded"), "false");
    await cancelled.press("Space");
    assert.equal(await cancelled.getAttribute("aria-expanded"), "true");
    const cancelledHistory = page.locator(
      `#${await cancelled.getAttribute("aria-controls")}`,
    );
    assert.equal(
      await cancelledHistory.getByRole("listitem").count(),
      2,
      "all prior submissions remain accessible",
    );
    assert.equal(
      await cancelledHistory
        .getByRole("button", { name: "종료학생 제출 자료 확인" })
        .count(),
      2,
    );
    await cancelledHistory
      .getByRole("button", { name: "종료학생 제출 자료 확인" })
      .first()
      .click();
    const reviewImage = page.getByRole("img", {
      name: `${changed.data.title} 1`,
      exact: true,
    });
    await reviewImage.waitFor();
    const reviewWidths = [];
    for (let sample = 0; sample < 5; sample++) {
      await page.waitForTimeout(300);
      reviewWidths.push((await reviewImage.boundingBox()).width);
    }
    assert(
      reviewWidths.at(-1) > 150,
      `teacher result page must remain readable: ${reviewWidths}`,
    );
    assert(
      Math.abs(reviewWidths[0] - reviewWidths.at(-1)) < 2,
      `teacher result fit must not shrink repeatedly: ${reviewWidths}`,
    );
    await page.getByRole("button", { name: "자료 확대", exact: true }).click();
    await page.waitForTimeout(350);
    assert(
      (await reviewImage.boundingBox()).width > reviewWidths.at(-1),
      "result review zoom enlarges source",
    );
    await page.getByRole("button", { name: "다음", exact: true }).click();
    await page
      .getByRole("img", { name: `${changed.data.title} 3`, exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "응시 주의사항", exact: true })
        .count(),
      0,
      "read-only review does not show student test instructions",
    );
    assert.equal(
      await page.getByText("안내", { exact: true }).count(),
      0,
      "no redundant bottom guidance card",
    );
    await page.screenshot({
      path: path.join(evidence, `teacher-result-review-${viewport.width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "닫기", exact: true })
      .last()
      .click();
    await page.locator('input[type="number"]').first().fill("22");
    await page
      .getByLabel("검증학생 배정 사유", { exact: true })
      .fill("수업 태도");
    await page.evaluate(() => (window.__fixture.pauseWrite = true));
    const resetButton = pending.getByRole("button", {
      name: "검증학생 재응시 제한 리셋",
      exact: true,
    });
    await resetButton.evaluate((button) => {
      button.click();
      button.click();
    });
    const reset = await waitWrite(page, 6);
    assert.deepEqual(Object.keys(reset.data).sort(), [
      "retryResetByStudentUid",
      "updatedAt",
    ]);
    assert.deepEqual(Object.keys(reset.data.retryResetByStudentUid), [
      "student-1",
    ]);
    assert(
      await page
        .getByRole("button", { name: "설정 저장", exact: true })
        .isDisabled(),
      "settings save waits for reset",
    );
    await page.evaluate(() => window.__fixture.releaseWrite());
    await pending.getByRole("status").waitFor();
    assert.equal(
      await pending.getByRole("status").textContent(),
      "재응시 대기 해제됨",
    );
    assert.equal(
      await page.locator('input[type="number"]').first().inputValue(),
      "22",
    );
    assert.equal(
      await page.getByLabel("검증학생 배정 사유", { exact: true }).inputValue(),
      "수업 태도",
    );
    assert.equal(
      await page.evaluate(() => window.__fixture.writes.length),
      6,
      "double click writes once",
    );
    await page.evaluate(() => (window.__fixture.failNextWrite = true));
    await cancelled.getByRole("button", { name: /재응시 제한 리셋$/ }).click();
    await waitWrite(page, 7);
    await cancelled
      .getByText("해제하지 못했습니다. 다시 시도해 주세요.", { exact: true })
      .waitFor();
    await cancelled.getByRole("button", { name: /재응시 제한 리셋$/ }).click();
    await waitWrite(page, 8);
    await cancelled.getByText("재응시 대기 해제됨", { exact: true }).waitFor();
    assert.equal(
      await cancelled.getAttribute("aria-expanded"),
      "true",
      "reset click does not toggle submission history",
    );
    assert.equal(
      await cancelled
        .getByRole("button", { name: /재응시 제한 리셋$/ })
        .textContent(),
      "리셋",
    );
    await pending.scrollIntoViewIfNeeded();
    const statusGeometry = await panel.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        viewport: innerWidth,
        overflow: el.scrollWidth > el.clientWidth + 1,
      };
    });
    assert(
      statusGeometry.left >= 0 &&
        statusGeometry.right <= viewport.width &&
        !statusGeometry.overflow,
      JSON.stringify(statusGeometry),
    );
    for (const button of await panel.getByRole("button").all()) {
      if (!(await button.isVisible())) continue;
      const denseAttemptAction = await button.evaluate((element) =>
        element.matches(".history-attempt-actions .history-action-button"),
      );
      const buttonBox = await button.boundingBox();
      // DESIGN.md (2026-10-15): only the attempt table's management actions
      // use 28px controls. Source selection and other controls still use 44px.
      assert(
        buttonBox.height >= (denseAttemptAction ? 28 : 44),
        denseAttemptAction
          ? "attempt table actions preserve the explicit 28px minimum"
          : "other touch controls remain at least 44px",
      );
    }
    await panel.locator("table").evaluate((table) => {
      table.parentElement.scrollLeft = 0;
    });
    await page.screenshot({
      path: path.join(evidence, `teacher-attempts-${viewport.width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "설정 저장", exact: true }).click();
    const savedAfterReset = await waitWrite(page, 9);
    assert(
      !savedAfterReset.options.mergeFields.includes("retryResetByStudentUid"),
    );
    const savedResetMarkers = await page.evaluate(
      (path) => window.__fixture.store[path].retryResetByStudentUid,
      created.path,
    );
    assert.deepEqual(
      savedResetMarkers,
      {
        "student-1": { seconds: 1790676000, nanoseconds: 0 },
        "student-2": { seconds: 1790676000, nanoseconds: 0 },
      },
      "settings save preserves both server timestamps",
    );
    assert.equal(savedAfterReset.data.timeLimitMinutes, 22);
    assert.equal(
      savedAfterReset.data.targetStudentReasons["student-1"],
      "수업 태도",
    );
    // Legacy fallback must update the original document without creating a scoped stub.
    const legacyPath = "history_classrooms/" + created.path.split("/").at(-1);
    await page.evaluate(
      ({ from, to }) => {
        window.__fixture.store[to] = window.__fixture.store[from];
        delete window.__fixture.store[from];
        window.__remount();
      },
      { from: created.path, to: legacyPath },
    );
    await page
      .getByRole("button", {
        name: `${changed.data.title} 설정 수정`,
        exact: true,
      })
      .click();
    await page
      .getByRole("row", { name: "검증학생 응시 현황", exact: true })
      .getByRole("button", { name: /재응시 제한 리셋$/ })
      .click();
    const legacyReset = await waitWrite(page, 10);
    assert.equal(legacyReset.path, legacyPath);
    assert.equal(
      await page.evaluate(
        (path) => Boolean(window.__fixture.store[path]),
        created.path,
      ),
      false,
    );
    await page
      .getByRole("button", { name: "배정 학생 추가", exact: true })
      .click();
    await page.getByLabel("추가할 학생 배정 사유", { exact: true }).fill("수업 태도");
    await page.getByLabel("전체 학생 이름 검색", { exact: true }).fill("추가학생");
    await page.getByRole("button", { name: /추가학생.*3-2/ }).click();
    const unsavedReset = page
      .getByRole("row", { name: "추가학생 응시 현황", exact: true })
      .getByRole("button", { name: /재응시 제한 리셋$/ });
    assert(
      await unsavedReset.isDisabled(),
      "unsaved assignment cannot issue a live reset",
    );
    assert.equal(
      await unsavedReset.getAttribute("title"),
      "학생 배정을 먼저 저장해 주세요.",
    );
    assert.equal(await page.evaluate(() => window.__fixture.writes.length), 10);
    await page.getByRole("button", { name: "취소", exact: true }).click();
    // A lesson edited since publication is imported only by the explicit action.
    await page.evaluate(
      ({ legacyPath, original, scope }) => {
        const f = window.__fixture;
        delete f.store[legacyPath];
        f.store[`${scope}/history_classrooms/refresh-fixture`] = original;
        f.store["users/inactive-student"] = {
          role: "student",
          name: "전출학생",
          grade: "3",
          class: "2",
          number: "20",
          enrollmentStatus: "transferred",
        };
        f.store["users/pending-student"] = {
          role: "student",
          name: "승인대기학생",
          grade: "3",
          class: "2",
          number: "21",
          registrationApprovalStatus: "pending",
        };
        window.__remount();
      },
      { legacyPath, original: created.data, scope },
    );
    await page
      .getByRole("button", { name: `${longTitle} 설정 수정`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "최신 수업 자료 반영", exact: true })
      .click();
    await page.getByText(/최신 학습지와 빈칸 2개를 반영합니다/).waitFor();
    assert.equal(
      await page.evaluate(() => window.__fixture.writes.length),
      10,
      "Refresh changes the draft only",
    );
    await page.getByRole("button", { name: "설정 저장", exact: true }).click();
    const refreshed = await waitWrite(page, 11);
    assert.equal(refreshed.data.blanks[0].answer, "원본에서 수정된 정답");
    assert.equal(
      refreshed.data.pdfPageImages[0].imageUrl,
      "/worksheet.svg?revision=2",
    );
    assert.equal(refreshed.data.blanks[0].id, created.data.blanks[0].id);
    assert.equal(refreshed.data.blanks[0].left, created.data.blanks[0].left);
    assert.equal(refreshed.data.blanks[0].top, created.data.blanks[0].top);

    await page.evaluate(() => {
      for (let index = 1; index <= 30; index++) {
        const suffix = String(index).padStart(2, "0");
        window.__fixture.store[`users/class-grant-${suffix}`] = {
          role: "student",
          name: `학급검증${suffix}`,
          grade: "3",
          class: "2",
          number: String(40 + index),
        };
      }
      window.__remount();
    });
    await page
      .getByRole("button", { name: "면제권 관리", exact: true })
      .click();
    await page
      .getByRole("button", { name: "학급 단위 부여", exact: true })
      .click();
    const exemptionModal = page.locator("div.fixed.inset-0").last();
    await exemptionModal.locator("select").nth(0).selectOption("3");
    await exemptionModal.locator("select").nth(1).selectOption("2");
    await page
      .getByRole("button", { name: "추가학생 제외", exact: true })
      .click();
    await page
      .getByRole("button", { name: "학급검증30 제외", exact: true })
      .click();
    await exemptionModal.getByText("부여 대상 32명 · 제외 2명", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "전출학생 제외", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "승인대기학생 제외", exact: true })
        .count(),
      0,
    );
    await exemptionModal
      .getByPlaceholder("예: 학교 행사, 공결, 상담 등")
      .fill("학급 활동 참여");
    await page.evaluate(() => {
      window.__fixture.pauseGrant = true;
      window.__fixture.failNextGrant = true;
    });
    const grantButton = exemptionModal
      .getByRole("button", { name: "면제권 부여", exact: true })
      .last();
    // Dispatch both events in one turn, before React's disabled state commits.
    await grantButton.evaluate((button) => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await page.waitForFunction(() =>
      window.__fixture.commands.some(
        (command) => command.commandType === "grantHistoryClassroomExemptions",
      ),
    );
    assert.equal(
      await page.evaluate(() => window.__fixture.commands.filter(command => command.commandType === "grantHistoryClassroomExemptions").length),
      1,
      "Repeated clicks issue one class grant while the first request is pending",
    );
    assert(await exemptionModal.getByRole("button", { name: "부여 중", exact: true }).isDisabled());
    await page.evaluate(() => window.__fixture.releaseGrant());
    await grantButton.waitFor();
    assert.equal(await exemptionModal.getByPlaceholder("예: 학교 행사, 공결, 상담 등").inputValue(), "학급 활동 참여");
    await exemptionModal.getByText("부여 대상 32명 · 제외 2명", { exact: true }).waitFor();
    assert(alerts.includes("서버 처리 결과를 확인하지 못했습니다. 잠시 후 같은 내용으로 다시 시도해 주세요."));
    const failedGrant = await page.evaluate(() => window.__fixture.commands.at(-1));
    await grantButton.click();
    await page.waitForFunction(() => window.__fixture.commands.filter(command => command.commandType === "grantHistoryClassroomExemptions").length === 2);
    const granted = await page.evaluate(() => window.__fixture.commands.at(-1));
    assert.deepEqual(granted, failedGrant, "Explicit retry preserves the 32 recipients, exclusions, semester and reason");
    assert.equal(granted.payload.semesterId, "2026-2");
    assert.equal(granted.payload.classId, "3-2");
    assert.deepEqual(granted.payload.recipientUids, [
      ...Array.from({ length: 29 }, (_, index) => `class-grant-${String(index + 1).padStart(2, "0")}`),
      "student-1", "student-2", "student-3",
    ].sort());
    await page.waitForFunction(() => document.querySelector('textarea[placeholder="예: 학교 행사, 공결, 상담 등"]')?.value === "");
    await page.screenshot({
      path: path.join(evidence, `teacher-exemption-${viewport.width}.png`),
      fullPage: true,
    });
    assert.deepEqual(errors, [], "no runtime errors");
    assert(
      alerts.every(
        (message) =>
          message === "역사교실 과제를 저장했습니다." ||
          message === "32명에게 면제권을 부여했습니다." ||
          message === "서버 처리 결과를 확인하지 못했습니다. 잠시 후 같은 내용으로 다시 시도해 주세요.",
      ),
      `unexpected alert: ${alerts.join(", ")}`,
    );
    const capture = await page.evaluate(() => ({
      writes: window.__fixture.writes,
      reads: window.__fixture.reads,
      notifications: window.__fixture.notifications,
    }));
    assert(
      capture.reads.every((read) => !read.includes("map_resources")),
      "History classroom never reads a live map resource",
    );
    reports.push({
      viewport,
      options,
      geometry,
      reasonGeometry,
      assignedReasonGeometry,
      editReasonGeometry,
      attemptColumnGeometry,
      dashboardGeometry,
      editGeometry,
      statusGeometry,
      reviewWidths,
      errors,
      alerts,
      ...capture,
    });
    await page.close();
    console.log(
      `teacher ${viewport.width}px create/edit/source-switch/snapshot/attempt-history/reset: passed`,
    );
  }
} finally {
  await fs.writeFile(
    path.join(evidence, "teacher-browser-report.json"),
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        coverage:
          "actual ManageHistoryClassroom and source builder; in-memory backend; Edge touch emulation, no production data",
        reports,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(`Evidence: ${evidence}`);
