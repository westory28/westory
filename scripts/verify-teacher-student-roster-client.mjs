import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const scope = { year: "2026", semester: "2" };
const makeUser = (uid) => ({
  uid,
  authTime: 10,
  async getIdTokenResult() {
    return { claims: { auth_time: this.authTime } };
  },
});
async function fixture(archive = false) {
  const qa = {
    auth: { currentUser: makeUser("teacher") },
    pending: [],
    calls: 0,
    archiveReads: 0,
  };
  const mocks = {
    firebase: "export const auth=globalThis.qa.auth;export const db={};",
    applicationSession:
      "export const callWithApplicationSession=async(name,input)=>{globalThis.qa.calls++;return{data:await new Promise((resolve,reject)=>globalThis.qa.pending.push({name,input,resolve,reject}))};};",
    semesterScope: "export const getYearSemester=config=>config;",
    semesterArchive: `export const isSemesterArchive=${archive};`,
    "firebase/firestore":
      "export const collection=()=>({});export const doc=()=>({});export const getDocs=async()=>{globalThis.qa.archiveReads++;return{docs:[{id:'legacy',data:()=>({studentName:'예시'})}]}};export const getDoc=async()=>{globalThis.qa.archiveReads++;return{exists:()=>false}};",
  };
  const result = await build({
    stdin: {
      contents: `import {loadTeacherStudentRoster} from './src/lib/teacherStudentRoster';globalThis.loadRoster=loadTeacherStudentRoster;`,
      resolveDir: root,
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "iife",
    plugins: [
      {
        name: "services",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            const key =
              args.path === "firebase/firestore"
                ? args.path
                : args.path.split("/").pop();
            return key in mocks ? { path: key, namespace: "mock" } : undefined;
          });
          builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
            contents: mocks[args.path],
            loader: "ts",
          }));
        },
      },
    ],
  });
  const context = vm.createContext({ qa });
  vm.runInContext(result.outputFiles[0].text, context);
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const resolve = (index) =>
    qa.pending[index].resolve({
      ...qa.pending[index].input,
      students: [],
      schoolConfig: null,
    });
  return { qa, load: context.loadRoster, tick, resolve };
}

const { qa, load, tick, resolve } = await fixture();
const simultaneous = Array.from({ length: 20 }, () => load(scope, "teacher"));
await tick();
assert.equal(qa.calls, 1);
resolve(0);
await Promise.all(simultaneous);
let request = load(scope, "teacher");
await tick();
assert.equal(
  qa.calls,
  2,
  "completed data must not skip a fresh server permission check",
);
resolve(1);
await request;
request = load(scope, "teacher");
await tick();
qa.pending[2].reject(new Error("offline"));
await assert.rejects(request, /offline/);
request = load(scope, "teacher");
await tick();
assert.equal(qa.calls, 4, "errors must not be cached");
resolve(3);
await request;
const first = load(scope, "teacher");
const fresh = load(scope, "teacher", { fresh: true });
const permission = load(scope, "staff-read");
const semester = load({ ...scope, semester: "1" }, "teacher");
await tick();
assert.equal(
  qa.calls,
  8,
  "explicit refresh, permission and semester changes must not share stale reads",
);
for (let index = 4; index < 8; index++) resolve(index);
await Promise.all([first, fresh, permission, semester]);
request = load(scope, "teacher");
await tick();
qa.auth.currentUser = makeUser("another-teacher");
resolve(8);
await assert.rejects(request, /로그인 상태가 변경/);
request = load(scope, "teacher");
await tick();
qa.auth.currentUser.authTime = 11;
resolve(9);
await assert.rejects(request, /로그인 상태가 변경/);
request = load(scope, "teacher");
await tick();
qa.pending[10].resolve({ year: "2025", semester: "2", students: [] });
await assert.rejects(request, /학기를 확인/);
const archived = await fixture(true);
const oldRoster = await archived.load(scope, "teacher");
assert.equal(oldRoster.students[0].id, "legacy");
assert.equal(archived.qa.calls, 0);
assert.equal(archived.qa.archiveReads, 2);
console.log(
  "PASS teacher roster: 20 overlapping loads use one request; completed/error reads are not cached; fresh/permission/semester/auth identity boundaries, stale responses and archive fallback preserved; no writes.",
);
