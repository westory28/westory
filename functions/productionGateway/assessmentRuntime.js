// A paper's source, frozen snapshot and receipt coexist while a request runs.
// Keep class-wide starts from putting 80 such requests in one 256 MiB process.
// No idle instance is reserved; the existing Seoul endpoints remain compatible.
module.exports = Object.freeze({
  region: "asia-northeast3",
  memory: "512MiB",
  cpu: 1,
  concurrency: 8,
  maxInstances: 20,
  minInstances: 0,
  timeoutSeconds: 60,
});
