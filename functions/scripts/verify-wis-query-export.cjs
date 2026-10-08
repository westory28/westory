const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const app = initializeApp({ projectId: 'demo-westory-query-contract' });
const endpoint = require('../studentWisQuery');
assert.deepEqual(Object.keys(endpoint), ['getWisEconomyState']);
assert.deepEqual(endpoint.getWisEconomyState.__endpoint.region, ['asia-northeast3']);
assert.equal(typeof endpoint.getWisEconomyState, 'function');
// The restored factory is the live source contract: preserve all callable
// options (including defaults) while narrowing deployment to Seoul alone.
const { createWisCallableExports } = require('../productionGateway/wisEconomyQuery');
const liveEndpoint = createWisCallableExports({ core: {} }).getWisEconomyState;
const { region: liveRegions, ...liveOptions } = liveEndpoint.__endpoint;
const { region: releaseRegions, ...releaseOptions } = endpoint.getWisEconomyState.__endpoint;
assert.deepEqual(liveRegions, ['asia-northeast3', 'us-central1']);
assert.deepEqual(releaseOptions, liveOptions);
console.log('PASS isolated Wis query export: Seoul only; live callable options preserved; no other callable or US deployment target; network 0');
deleteApp(app).catch(error => { console.error(error); process.exitCode = 1; });
