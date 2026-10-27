const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const app = initializeApp({ projectId: 'demo-westory-query-contract' });
const endpoint = require('../studentWisQuery');
assert.deepEqual(Object.keys(endpoint), ['getWisEconomyState', 'getWisEconomyStateFast']);
assert.deepEqual(endpoint.getWisEconomyState.__endpoint.region, ['asia-northeast3', 'us-central1']);
assert.equal(typeof endpoint.getWisEconomyState, 'function');
assert.equal(typeof endpoint.getWisEconomyStateFast, 'function');
assert.deepEqual(endpoint.getWisEconomyStateFast.__endpoint.region, ['us-central1']);
assert.equal(endpoint.getWisEconomyStateFast.__endpoint.concurrency, 80);
assert.equal(endpoint.getWisEconomyStateFast.__endpoint.maxInstances, 20);
// Preserve both compatibility regions so a selected deployment cannot delete
// the old US endpoint while updating Seoul. Other options retain the contract.
const { createWisCallableExports } = require('../productionGateway/wisEconomyQuery');
const liveEndpoint = createWisCallableExports({ core: {} }).getWisEconomyState;
const { region: liveRegions, ...liveOptions } = liveEndpoint.__endpoint;
const { region: releaseRegions, ...releaseOptions } = endpoint.getWisEconomyState.__endpoint;
assert.deepEqual(liveRegions, ['asia-northeast3', 'us-central1']);
assert.deepEqual(releaseOptions, liveOptions);
console.log('PASS isolated Wis query exports: both compatibility regions and bounded nam5-local read endpoint; network 0');
deleteApp(app).catch(error => { console.error(error); process.exitCode = 1; });
