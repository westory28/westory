const { getFirestore } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");
const { onCallWithStudentMaintenance: onCall } = require("./studentMaintenance");
const { assertActiveApplicationSession } = require("./sessionAuthority");
const { createFirestoreStore } = require("./productionGateway/commandGateway");
const { createW8QueryCore } = require("./productionGateway/w8Domains");

let sharedCore;
const getCore = () => (sharedCore ||= createW8QueryCore({
  store: createFirestoreStore(getFirestore(), { readOnly: true }),
  assertSession: assertActiveApplicationSession,
}));

// Keep the deployed W8/archived-domain contract untouched. This endpoint serves
// only the current Think Cloud screen and its existing command preconditions.
const createThinkCloudQueryHandler = (core) => async (request) => {
  const data = request.data;
  const keys = new Set(["semesterId", "domain", "source", "audience", "projection", "sessionId", "_session"]);
  if (!data || typeof data !== "object" || Array.isArray(data)
      || Object.keys(data).some((key) => !keys.has(key))
      || data.domain !== "LEARNING" || data.source !== "CURRENT"
      || !["think-cloud", "think-cloud-command"].includes(data.projection)) {
    throw new HttpsError("invalid-argument", "Only current Think Cloud queries are supported.", {
      reason: "THINK_CLOUD_QUERY_SCOPE_INVALID",
    });
  }
  return (core || getCore()).getW8DomainState(request);
};

exports.createThinkCloudQueryHandler = createThinkCloudQueryHandler;
exports.getThinkCloudState = onCall({ region: "asia-northeast3" }, createThinkCloudQueryHandler());
