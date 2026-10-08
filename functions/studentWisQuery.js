const { getFirestore } = require('firebase-admin/firestore');
const { createFirestoreStore } = require('./productionGateway/commandGateway');
const { createWisQueryCore } = require('./productionGateway/wisEconomyQuery');
const { onCallWithStudentMaintenance } = require('./productionGateway/studentMaintenance');

// The restored live query preserves explicit teacher archive reads. Only the
// Seoul endpoint is exported; the existing us-central1 deployment is untouched.
const core = createWisQueryCore({ store: createFirestoreStore(getFirestore()) });
exports.getWisEconomyState = onCallWithStudentMaintenance(
  { region: 'asia-northeast3' },
  request => core.getWisEconomyState(request),
);
