import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { accessToken, readCloud, sourceUrl, zipInventory, inventory, resourceFields, resourceValue } from './prepare-wispi-market-release.mjs';

const audit=path.resolve('output/wispi-access-20261115/release');
const prepared=JSON.parse(await fs.readFile(path.join(audit,'prepared.json'),'utf8'));
const after=process.argv.includes('--after');
assert.ok(process.argv.slice(2).every(a=>a==='--after'));
const token=after?accessToken():null, sources=new Map(), reports=[];
for(const manifest of prepared) {
  const directory=path.join(manifest.directory,'functions');
  const expected=Object.entries(manifest.expectedHashes).map(([name,sha256])=>({path:name,sha256})).sort((a,b)=>a.path.localeCompare(b.path));
  assert.deepEqual(await inventory(directory),expected,'Prepared package changed after review');
  if (manifest.kind === 'stocks') {
    const endpoints=JSON.parse(execFileSync(process.execPath,['-e',"const e=require('./'); console.log(JSON.stringify(Object.fromEntries(Object.entries(e).map(([n,f])=>[n,f.__endpoint]))));"],{cwd:directory,encoding:'utf8'}));
    assert.deepEqual(Object.keys(endpoints).sort(),[...manifest.targets.map(t=>t.name),...manifest.newTargets].sort());
    for(const name of manifest.newTargets){assert.equal(endpoints[name].platform,'gcfv2');assert.deepEqual(endpoints[name].region,['us-central1']);}
    assert.deepEqual(endpoints.settleWisStockOrderTask.taskQueueTrigger.invoker,['177587430482-compute@developer.gserviceaccount.com']);
    assert.equal(endpoints.onWisStockEnrollmentSlotWritten.eventTrigger.eventFilterPathPatterns.document,'semester_enrollment_slots/{slotId}');
  }
  if(!after) {reports.push({kind:manifest.kind,files:expected.length,localVerified:true});continue;}
  for(const target of [...manifest.targets,...manifest.newTargets.map(name=>({name,region:'us-central1'}))]) {
    const metadata=await(await readCloud(`https://cloudfunctions.googleapis.com/v2/projects/${manifest.project}/locations/${target.region}/functions/${target.name}`,token)).json();
    assert.equal(metadata.state,'ACTIVE',target.name);assert.equal(metadata.buildConfig.runtime,'nodejs22');
    const source=metadata.buildConfig.source.storageSource,key=sourceUrl(source);
    if(!sources.has(key))sources.set(key,await zipInventory(Buffer.from(await(await readCloud(key,token)).arrayBuffer())));
    assert.deepEqual(sources.get(key).map(({body,...entry})=>entry),expected,`${target.name} live source differs from reviewed package`);
    if(target.serviceConfig)for(const field of resourceFields)assert.equal(resourceValue(metadata.serviceConfig,field),resourceValue(target.serviceConfig,field),`${target.name}/${field}`);
    else {
      assert.equal(metadata.serviceConfig.minInstanceCount||0,0);
      assert.equal(metadata.serviceConfig.availableMemory,'256Mi');
      assert.equal(metadata.serviceConfig.maxInstanceCount,target.name==='recoverWisStockOrders'?1:target.name==='settleWisStockOrderTask'?5:10);
    }
    reports.push({name:target.name,region:target.region,state:metadata.state,files:expected.length,sourceGeneration:source.generation,verified:true});
  }
}
await fs.writeFile(path.join(audit,after?'verified-after.json':'verified-prepared.json'),JSON.stringify(reports,null,2));
console.log(JSON.stringify(reports,null,2));
