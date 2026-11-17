import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, audit, transplant } from './prepare-avatar-ranks-release.mjs';
import { accessToken } from './prepare-weplay-avatar-release.mjs';
import { readCloud, sourceUrl, zipInventory, sha, inventory, resourceFields, resourceValue } from './prepare-wispi-market-release.mjs';

// --local tests only synthetic fixtures. --before/--after read cloud metadata and
// source archives; --after also confirms anonymous requests remain rejected.
const after = process.argv.includes('--after'), local = process.argv.includes('--local');
assert.ok(process.argv.slice(2).every(arg => ['--after', '--before', '--local'].includes(arg)));
assert.ok(!(after && process.argv.includes('--before')));
const plans = JSON.parse(await fs.readFile(path.join(audit, 'prepared.json'), 'utf8'));
const localProbe = String.raw`
const assert = require('node:assert/strict'), path = require('node:path');
const base = process.argv[1], root = process.argv[2], mode = process.argv[3], original = process.argv[4];
const fixture = require(path.join(root, 'functions/scripts/verify-student-avatar.cjs'));
const catalog = require(path.join(base, 'studentAvatarCatalog.js'));
const previous = require(path.join(original, 'avatarCatalog.json'));
let combinations = 0;
for (const item of catalog.catalog.items) for (const character of item.characters) {
  const look = {...catalog.defaultLook(character), [item.slot]: item.value};
  assert.ok(catalog.validateLook(look), item.id);
  assert.ok(catalog.sanitizePublicAvatar({schemaVersion:1,catalogVersion:catalog.catalog.version,revision:1,look,lookHash:catalog.lookHash(look)}), item.id);
  combinations++;
}
const added = catalog.catalog.items.filter(item => !previous.items.some(old => old.id === item.id));
assert.ok(added.length >= 15, 'Expected at least three new goods for five ranks');
assert.equal(catalog.catalog.version, previous.version, 'Keep saved avatar generation');
for (const old of previous.items) assert.equal(catalog.catalog.items.find(item=>item.id===old.id)?.minPurchaseTier,'tier_1', 'Existing goods stay open at the lowest tier');
const rankCounts=Object.fromEntries(catalog.PURCHASE_TIER_CODES.map(code=>[code,added.filter(item=>item.minPurchaseTier===code).length]));
for (const count of Object.values(rankCounts)) assert.ok(count>=3, 'Each rank requires three new goods');
const summary = {combinations, newItems:added.length, rankCounts, catalogVersion:catalog.catalog.version};
async function run() {
if (mode !== 'projection') {
  const state = fixture.fixture(1000), teacherUid = 'bundle-test-teacher';
  state.documents.set('users/'+teacherUid,{role:'teacher'});
  const assertSession = async request => ({uid:request.auth.uid});
  const pricingModule = require(path.join(base,'avatarCatalogPricing.js'));
  const api = pricingModule.createAvatarCatalogPricingHandlers({db:state.db,assertSession,now:()=>100000});
  const teacher = data => ({auth:{uid:teacherUid},data:{_session:{},...data}});
  const item = added.find(item => catalog.canWearItem(item,'girl') && item.price > 0);
  assert.ok(item);
  const edit = teacher({expectedRevision:0,prices:{[item.id]:81},purchaseTiers:{[item.id]:'tier_5'}});
  const pricing = await api.updateAvatarCatalogPricing(edit);
  assert.equal(pricing.purchaseTiers[item.id],'tier_5');
  assert.equal(pricing.prices[item.id],81);
  assert.equal(state.writes.length,1);
  assert.equal(state.reads.filter(p=>p===pricingModule.PRICING_PATH).length,1);
  await api.updateAvatarCatalogPricing(edit);
  assert.equal(state.writes.length,1,'Retry must not write');
  summary.settingsWrites=1;
  const freeState=fixture.fixture(), freeApi=pricingModule.createAvatarCatalogPricingHandlers({db:freeState.db,assertSession,now:()=>100000});
  freeState.documents.set('users/'+teacherUid,{role:'teacher'});
  const fixedFree=catalog.catalog.items.find(entry=>entry.id===catalog.catalog.freeClothingItemIds[0]);
  await assert.rejects(freeApi.updateAvatarCatalogPricing(teacher({expectedRevision:0,purchaseTiers:{[fixedFree.id]:'tier_5'}})),error=>error.details?.reason==='AVATAR_PRICING_INPUT_INVALID');
  assert.equal(freeState.writes.length,0,'Invalid free restriction must not write');
  const paidHat=added.find(entry=>entry.slot==='accessory' && entry.minPurchaseTier==='tier_5' && entry.price>0);
  assert.ok(paidHat);
  await assert.rejects(freeApi.updateAvatarCatalogPricing(teacher({expectedRevision:0,prices:{[paidHat.id]:0},purchaseTiers:{[paidHat.id]:'tier_5'}})),error=>error.details?.reason==='AVATAR_PRICING_INPUT_INVALID');
  const makeFree=teacher({expectedRevision:0,prices:{[paidHat.id]:0}});
  const freePrice=await freeApi.updateAvatarCatalogPricing(makeFree);
  assert.equal(freePrice.purchaseTiers[paidHat.id],'tier_1');assert.equal(freePrice.prices[paidHat.id],0);
  assert.equal(freeState.writes.length,1);await freeApi.updateAvatarCatalogPricing(makeFree);assert.equal(freeState.writes.length,1);
  const paidAgain=await freeApi.updateAvatarCatalogPricing(teacher({expectedRevision:1,prices:{[paidHat.id]:paidHat.price}}));
  assert.equal(paidAgain.purchaseTiers[paidHat.id],'tier_1','Returning a new tier-five good to paid preserves the current unrestricted setting');
  summary.freeTierNormalization=true;
  if (mode === 'avatar') {
    const avatar = require(path.join(base,'studentAvatar.js')).createStudentAvatarHandlers({db:state.db,bucket:state.bucket,assertSession,now:()=>100000});
    state.documents.set('years/2026/semesters/2/point_policies/current',{rankPolicy:{tiers:[0,10,20,30,40].map((minPoints,index)=>({code:'tier_'+(index+1),minPoints}))}});
    state.documents.get(fixture.accountPath).rankEarnedTotal=39;
    const initial=await avatar.getAvatarStudioState(fixture.req({year:'2026',semester:'2'}));
    assert.equal(initial.purchaseTierCode,'tier_4');
    assert.deepEqual(initial.allowedPurchaseTiers,['tier_1','tier_2','tier_3','tier_4']);
    const input=fixture.req({year:'2026',semester:'2',itemId:item.id,requestId:'bundle-tier-purchase',expectedPrice:81,expectedPricingRevision:pricing.revision,expectedPricingPolicyVersion:catalog.catalog.pricingPolicyVersion});
    const before=state.writes.length;
    await assert.rejects(avatar.purchaseStudentAvatarItem(input),error=>{
      assert.equal(error.details?.reason,'AVATAR_TIER_LOCKED');assert.deepEqual(error.details.allowedPurchaseTiers,initial.allowedPurchaseTiers);return true;
    });
    assert.equal(state.writes.length,before,'Denial must not write');
    state.documents.get(fixture.accountPath).rankEarnedTotal=40;
    const purchased=await avatar.purchaseStudentAvatarItem(input);
    assert.equal(purchased.purchaseTierCode,'tier_5'); assert.equal(purchased.charged,81);assert.equal(purchased.wallet.balance,919);
    assert.deepEqual(purchased.allowedPurchaseTiers,catalog.PURCHASE_TIER_CODES);
    const chargedWrites=state.writes.length;
    const duplicate=await avatar.purchaseStudentAvatarItem(input);
    assert.equal(duplicate.duplicate,true);assert.equal(state.writes.length,chargedWrites);
    state.documents.get(fixture.accountPath).rankEarnedTotal=0;
    const owned=await avatar.purchaseStudentAvatarItem({...input,data:{...input.data,requestId:'bundle-owned-item'}});
    assert.equal(owned.alreadyOwned,true);assert.equal(owned.charged,0);assert.equal(state.writes.length,chargedWrites);
    const look={...catalog.defaultLook('girl'),[item.slot]:item.value};
    const saved=await avatar.saveStudentAvatar(await fixture.save({look,expectedRevision:purchased.avatar.revision,requestId:'bundle-tier-save'}));
    assert.deepEqual(saved.look,look);assert.ok(saved.ownedItemIds.includes(item.id));
    summary.tierDenialWrites=0;summary.exactThresholdPurchase=true;summary.ownedAfterDowngrade=true;summary.duplicatePurchaseWrites=0;
    const customPolicies=[
      {tiers:[[1,0],[2,10],[3,20],[4,30],[5,40],[6,50]],total:50,current:'tier_6',allowed:[1,2,3,4,5]},
      {tiers:[[1,0],[2,10],[3,20],[5,30],[4,40]],total:30,current:'tier_5',allowed:[1,2,3,5]},
      {tiers:[[1,0],[2,10],[4,30],[5,40]],total:40,current:'tier_5',allowed:[1,2,4,5]},
      {tiers:[[6,0]],total:50,current:'tier_6',allowed:[1]},
    ];
    for(const policy of customPolicies) for(const required of catalog.PURCHASE_TIER_CODES) {
      const test=fixture.fixture(), allowed=policy.allowed.map(index=>'tier_'+index);
      const customApi=require(path.join(base,'studentAvatar.js')).createStudentAvatarHandlers({db:test.db,bucket:test.bucket,assertSession,now:()=>100000});
      test.documents.get(fixture.accountPath).rankEarnedTotal=policy.total;
      test.documents.set('years/2026/semesters/2/point_policies/current',{rankPolicy:{tiers:policy.tiers.map(([index,minPoints])=>({code:'tier_'+index,minPoints}))}});
      test.documents.set(pricingModule.PRICING_PATH,{schemaVersion:1,revision:1,prices:{[item.id]:81},purchaseTiers:{[item.id]:required}});
      const studio=await customApi.getAvatarStudioState(fixture.req({year:'2026',semester:'2'}));
      assert.equal(studio.purchaseTierCode,policy.current);assert.deepEqual(studio.allowedPurchaseTiers,allowed);
      if(allowed.includes(required)) {
        const result=await customApi.purchaseStudentAvatarItem(input);
        assert.deepEqual(result.allowedPurchaseTiers,allowed);assert.equal(result.charged,81);
      } else {
        await assert.rejects(customApi.purchaseStudentAvatarItem(input),error=>{
          assert.equal(error.details?.reason,'AVATAR_TIER_LOCKED');assert.deepEqual(error.details.allowedPurchaseTiers,allowed);return true;
        });
        assert.equal(test.writes.length,0);assert.equal(test.documents.get(fixture.accountPath).balance,1000);
      }
    }
    summary.authoritativeCustomPolicyCases=customPolicies.length*catalog.PURCHASE_TIER_CODES.length;
  }
}
process.stdout.write(JSON.stringify(summary));
}
run().catch(error=>{console.error(error);process.exitCode=1;});`;

const results = [], token = local ? null : await accessToken();
for (const plan of plans) {
  const source = path.join(plan.directory, 'functions');
  assert.deepEqual(await inventory(source), Object.entries(plan.expectedHashes).map(([path, sha256]) => ({path, sha256})).sort((a,b) => a.path.localeCompare(b.path)), 'Prepared source drift');
  for (const file of plan.changes) {
    const original = await fs.readFile(path.join(plan.targets[0].snapshotDirectory, 'functions', file), 'utf8');
    const current = await fs.readFile(path.join(root, 'functions', file), 'utf8');
    assert.equal(sha(transplant(file, original, current)), plan.expectedHashes[file], `Working patch changed after preparation: ${file}`);
  }
  if (local) {
    const summary = JSON.parse(execFileSync(process.execPath, ['-e', localProbe, source, root, plan.mode, path.join(plan.targets[0].snapshotDirectory, 'functions')], {
      env:{...process.env,NODE_PATH:path.join(root,'functions/node_modules')},encoding:'utf8',maxBuffer:4*1024*1024,
    }));
    results.push({group:path.basename(plan.directory),mode:plan.mode,...summary});
    continue;
  }
  for (const target of plan.targets) {
    const name = `projects/history-quiz-yongsin/locations/${target.region}/functions/${target.name}`;
    const current = await (await readCloud(`https://cloudfunctions.googleapis.com/v2/${name}`, token)).json();
    assert.equal(current.state,'ACTIVE',name);assert.equal(current.buildConfig.runtime,target.runtime,name);
    for (const field of resourceFields) assert.equal(resourceValue(current.serviceConfig,field),resourceValue(target.serviceConfig,field),`${name}/${field}`);
    if (!after) assert.equal(String(current.buildConfig.source.storageSource.generation),String(target.sourceGeneration),`Production source changed: ${name}`);
    let sourceFiles = 0;
    if (after) {
      const bytes=Buffer.from(await (await readCloud(sourceUrl(current.buildConfig.source.storageSource),token)).arrayBuffer());
      const entries=await zipInventory(bytes);
      assert.equal(entries.length,Object.keys(plan.expectedHashes).length,`${name}/source count`);
      for (const entry of entries) assert.equal(entry.sha256,plan.expectedHashes[entry.path],`${name}/${entry.path}`);
      sourceFiles=entries.length;
      const denied=await fetch(`https://${target.region}-history-quiz-yongsin.cloudfunctions.net/${target.name}`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:{}}),signal:AbortSignal.timeout(60000),
      });
      assert.ok([400,401,403].includes(denied.status),`Anonymous request accepted: ${name}`);
    }
    results.push({name:target.name,region:target.region,state:current.state,runtimePreserved:true,sourceVerified:after,sourceFiles});
  }
}
await fs.writeFile(path.join(audit,local?'verification-local.json':after?'verification-after.json':'verification-before.json'),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2));
console.log(JSON.stringify(results,null,2));
