import { spawnSync } from 'node:child_process';
import { join, delimiter } from 'node:path';
import assert from 'node:assert/strict';
const mode=process.argv[2];
assert.ok(['trading','access'].includes(mode),'Use trading or access');
const env={...process.env};
if(process.platform==='win32'){
  const java=spawnSync('java',['-XshowSettings:properties','-version'],{encoding:'utf8'});
  const javaHome=/^\s*java\.home\s*=\s*(.+)$/m.exec(java.stderr||'')?.[1].trim();
  if(!javaHome||java.status!==0)throw Error('Cannot locate Firestore emulator JDK');
  const key=Object.keys(env).find(k=>k.toUpperCase()==='PATH')||'PATH';env[key]=join(javaHome,'bin')+delimiter+env[key];
}
const project=mode==='trading'?'demo-westory-session-wis-stock-trading':'demo-westory-wispi-access';
const script=mode==='trading'?'functions/scripts/verify-wis-stock-trading-integration.cjs':'scripts/verify-wis-stock-access-rules.mjs';
const result=spawnSync(`firebase emulators:exec --only firestore --config firebase.wis-stock-${mode}-test.json --project ${project} "node ${script}"`,{shell:true,env,stdio:'inherit'});
if(result.error)throw result.error;process.exitCode=result.status??1;
