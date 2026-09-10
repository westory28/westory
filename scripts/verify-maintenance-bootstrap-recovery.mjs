import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {transformSync} from "esbuild";

const module={exports:{}};const held=[];let phase="old",calls=0;
const source=transformSync(readFileSync("src/lib/studentMaintenance.ts","utf8"),{loader:"ts",format:"cjs"}).code;
runInNewContext(source,{
  module,exports:module.exports,console:{error:()=>{}},
  require:name=>name==="firebase/firestore"?{
    doc:(_db,...parts)=>({path:parts.join("/")}),
    getDocFromServer:ref=>{calls++;if(phase==="old")return new Promise((_resolve,reject)=>held.push(reject));return Promise.resolve({exists:()=>ref.path.startsWith("users/"),data:()=>({role:"teacher"})});},
  }:name==="./permissions"?{ADMIN_EMAIL:"admin@example.test"}:{db:{}},
});
const {readStudentMaintenanceBootstrap}=module.exports;
const user={uid:"synthetic-a",email:"synthetic@example.test"};
const old=readStudentMaintenanceBootstrap(user);
assert.equal(held.length,2);
// prepareForReauthentication invalidates reads started under the previous epoch.
module.exports.invalidateStudentMaintenanceBootstrap?.(user.uid);
phase="fresh";
const fresh=readStudentMaintenanceBootstrap(user);
held.forEach(reject=>reject(Error("Synthetic old transport failure")));
assert.equal((await old).accessStatus,"error");
assert.equal((await fresh).accessStatus,"allowed","new epoch must not reuse the old in-flight failure");
assert.equal((await readStudentMaintenanceBootstrap(user)).accessStatus,"allowed","late old response must not overwrite fresh cache");
assert.equal(calls,4);
console.log(JSON.stringify({suite:"maintenance-bootstrap-recovery",passed:true,cases:5}));
