const assert = require('node:assert/strict');
const gateway = require('../commandGateway').createCallableExports({core: {}});
const archive = require('../archiveEnrollment').createArchiveEnrollmentCallableExports({core: {}});
const wis = require('../wisEconomy').createWisCallableExports({core: {}});
const w8 = require('../w8Domains').createW8CallableExports({core: {}});
for (const callable of [gateway.getSemesterCoreState, archive.getArchiveEnrollmentState, wis.getWisEconomyState, w8.getW8DomainState]) {
  assert.deepEqual(callable.__endpoint.region, ['asia-northeast3', 'us-central1']);
  assert.equal(JSON.stringify(callable.__endpoint.minInstances), 'null', 'Do not introduce permanent warm capacity');
  assert.ok(callable.__endpoint.callableTrigger);
}
for (const callable of [gateway.executeCommand, gateway.getCommandStatus, archive.previewEnrollmentRoster]) {
  assert.deepEqual(callable.__endpoint.region, ['asia-northeast3']);
}
console.log('PASS: four read callables retain Seoul and add Firestore-adjacent US region; command/session transport unchanged; no warm-capacity increase.');
