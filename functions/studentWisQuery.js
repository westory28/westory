const { getFirestore } = require('firebase-admin/firestore');
const { createFirestoreStore } = require('./productionGateway/commandGateway');
const { createWisQueryCore } = require('./productionGateway/wisEconomyQuery');
const { onCallWithStudentMaintenance } = require('./productionGateway/studentMaintenance');

// Snapshot reads must not lock accounts while students spend or teachers grant.
// Keep the old callable for open clients and give new clients a nam5-local route.
const core = createWisQueryCore({ store: createFirestoreStore(getFirestore(), { readOnly: true }) });
exports.getWisEconomyState = onCallWithStudentMaintenance(
  { region: ['asia-northeast3', 'us-central1'] },
  request => core.getWisEconomyState(request),
);
exports.getWisEconomyStateFast = onCallWithStudentMaintenance(
  { region: 'us-central1', memory: '256MiB', maxInstances: 20, concurrency: 80 },
  request => core.getWisEconomyState(request),
);
