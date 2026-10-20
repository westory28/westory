const { getFirestore } = require('firebase-admin/firestore');
const { createFirestoreStore } = require('./productionGateway/commandGateway');
const { createWisQueryCore } = require('./productionGateway/wisEconomyQuery');
const { onCallWithStudentMaintenance } = require('./productionGateway/studentMaintenance');

// Firestore is in nam5. Keep this bounded read beside the database without
// changing the existing full Wis query endpoints. One small standby instance
// avoids recurring cold starts; no requests or timers are used to keep it warm.
const core = createWisQueryCore({ store: createFirestoreStore(getFirestore(), { readOnly: true }) });
exports.getWisRankingPreview = onCallWithStudentMaintenance(
  { region: 'us-central1', memory: '256MiB', minInstances: 1, maxInstances: 3, concurrency: 80 },
  request => core.getWisEconomyState({
    ...request,
    // Only the full hall may opt into another bounded ranking projection.
    // Catalog, ledger, account and other query projections stay inaccessible.
    data: { ...request.data, projection: request.data?.projection === 'hall-of-fame' ? 'hall-index' : 'ranking-preview' },
  }),
);
