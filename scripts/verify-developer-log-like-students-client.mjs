import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = `
export const auth={currentUser:null};
export const qa={requests:[],calls:[]};
export const callWithApplicationSession=(name,input,user,options)=>new Promise((resolve,reject)=>{
 const request={name,input,user,dispatch(){try{options.beforeDispatch?.();qa.calls.push({name,input,user});}catch(error){reject(error)}},resolve(){resolve({data:{students:[],nextCursor:null,hasMore:false}})},reject};qa.requests.push(request);
});`;
const result = await build({
  stdin: {
    contents:
      'export {getDeveloperLogLikeStudents} from "./src/lib/developerLogLikeStudents";export {auth,qa} from "fixture";',
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [
    {
      name: "local-client",
      setup(plugin) {
        plugin.onResolve(
          { filter: /^(fixture|\.\/firebase|\.\/applicationSession)$/ },
          () => ({ path: "fixture", namespace: "test" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "test" }, () => ({
          contents: fixture,
          loader: "js",
        }));
      },
    },
  ],
});
const module = { exports: {} };
new Function("module", "exports", result.outputFiles[0].text)(
  module,
  module.exports,
);
const { getDeveloperLogLikeStudents: read, auth, qa } = module.exports;
const first = { uid: "teacher-one" },
  second = { uid: "teacher-two" };
auth.currentUser = first;
const one = read(first, "post-a");
assert.strictEqual(
  read(first, "post-a"),
  one,
  "Duplicate concurrent first page shares a single promise",
);
assert.equal(qa.requests.length, 1);
qa.requests[0].dispatch();
qa.requests[0].resolve();
await one;
const fresh = read(first, "post-a");
assert.notStrictEqual(fresh, one, "No resolved-name cache on reopen");
qa.requests[1].dispatch();
qa.requests[1].resolve();
await fresh;
const a = read(first, "post-a", "page-40"),
  b = read(first, "post-b");
assert.equal(qa.requests.length, 4);
for (const request of qa.requests.slice(2)) {
  request.dispatch();
  request.resolve();
}
await Promise.all([a, b]);
assert.equal(qa.calls[2].input.cursor, "page-40");
assert.equal(qa.calls[2].input.pageSize, 40);
const queued = read(first, "post-c");
auth.currentUser = second;
qa.requests[4].dispatch();
await assert.rejects(queued, /로그인 상태/);
assert.equal(
  qa.calls.length,
  4,
  "Changed account before proof completion causes zero dispatch",
);
assert.throws(() => read(first, "post-c"), /로그인 상태/);
const later = read(second, "post-c");
qa.requests[5].dispatch();
auth.currentUser = first;
qa.requests[5].resolve();
await assert.rejects(
  later,
  /로그인 상태/,
  "Already dispatched previous identity result is rejected",
);
const failure = read(first, "post-f");
qa.requests[6].dispatch();
qa.requests[6].reject(Error("fixture-failure"));
await assert.rejects(failure, /fixture-failure/);
const retry = read(first, "post-f");
qa.requests[7].dispatch();
qa.requests[7].resolve();
await retry;
assert.equal(
  qa.requests.length,
  8,
  "Failed flight is removed for explicit retry",
);
assert(qa.calls.every((call) => call.name === "getDeveloperLogLikeStudents"));
console.log(
  "PASS developer-log liker client: scoped in-flight deduplication, fresh reopen, page boundary, pre-dispatch identity fence, stale response and failure retry.",
);
