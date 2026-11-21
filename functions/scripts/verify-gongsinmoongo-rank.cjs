const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { accountIdFor } = require('../studentWisWallet');
const { resolveStudentProfileEmoji } = require('../studentProfileEmojiPolicy');

// Execute the actual private projection with a read-only transaction fixture.
// Session, enrollment and command guards remain covered by the integration suite.
const source = fs.readFileSync(path.join(__dirname, '../gongsinmoongo.js'), 'utf8');
const start = source.indexOf('async function profileEmoji(');
const end = source.indexOf('\nasync function notificationPlan(', start);
assert(start >= 0 && end > start);
const scope = '2026-2', uid = 'synthetic-student', id = accountIdFor(scope, uid);
const context = { scope, uid, profile: { profileEmojiId: 'fox', profileIcon: '🦊' } };
const policy = { tiers: [{ code: 'tier_1', minPoints: 0, allowedEmojiIds: ['smile'] },
  { code: 'tier_5', minPoints: 10000, allowedEmojiIds: ['fox'] }] };
const sandbox = { accountIdFor, resolveStudentProfileEmoji,
  root: value => `years/${value.slice(0, 4)}/semesters/${value.slice(-1)}` };
vm.runInNewContext(`${source.slice(start, end)}\nthis.profileEmoji = profileEmoji;`, sandbox);
let calls = 0;
const run = async patch => {
  const account = { accountId: id, studentUid: uid, semesterId: scope, schemaVersion: 1,
    policyVersion: 'w7-v1', status: 'ACTIVE', readOnly: false,
    earnedTotal: 10010, rankEarnedTotal: 9510, balance: 1, ...patch };
  const before = structuredClone(account);
  const tx = { async getAll(...refs) {
    calls++;
    assert.deepEqual(refs, [`semester_wis_accounts/${id}`, 'years/2026/semesters/2/point_policies/current']);
    return [{ data: () => account }, { data: () => ({ rankPolicy: policy }) }];
  } };
  const result = await sandbox.profileEmoji({ doc: value => value }, tx, context);
  assert.deepEqual(account, before, 'Projection does not rewrite account data');
  return result;
};
(async () => {
  assert.equal(await run({}), 'fox');
  assert.equal(await run({ earnedTotal: 10000 }), 'fox');
  assert.equal(await run({ earnedTotal: 9999, rankEarnedTotal: 99999, balance: 99999 }), 'smile');
  for (const earnedTotal of [undefined, null, -1, NaN, 10000.5, '10000'])
    assert.equal(await run({ earnedTotal }), 'smile');
  for (const patch of [{ studentUid: 'other' }, { semesterId: '2026-1' }, { accountId: 'other' },
    { status: 'CLOSED' }, { readOnly: true }, { schemaVersion: 2 }, { policyVersion: 'other' }])
    assert.equal(await run(patch), 'smile');
  assert.equal(calls, 16);
  console.log('PASS Gongsinmoongo cumulative rank: 16 boundary, malformed, scope and account-state cases; exactly two document reads per projection, zero writes.');
})().catch(error => { console.error(error); process.exitCode = 1; });
