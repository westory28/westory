const { getFirestore } = require('firebase-admin/firestore');
const { createFirestoreStore } = require('./productionGateway/commandGateway');
const { createWisQueryCore } = require('./productionGateway/wisEconomyQuery');
const { onCallWithStudentMaintenance } = require('./productionGateway/studentMaintenance');

// Firestore is in nam5. Keep this bounded read beside the database without
// changing the existing full Wis query endpoints or reserving idle instances.
const core = createWisQueryCore({ store: createFirestoreStore(getFirestore(), { readOnly: true }) });
exports.getWisRankingPreview = onCallWithStudentMaintenance(
  { region: 'us-central1' },
  request => core.getWisEconomyState({
    ...request,
    data: { ...request.data, projection: 'ranking-preview' },
  }),
);
