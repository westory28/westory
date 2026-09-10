const { storageBucket } = require("firebase-functions/params");
const { onObjectFinalized } = require("firebase-functions/v2/storage");

// Retain the deployed trigger name so delayed legacy events drain harmlessly.
// New uploads are processed exclusively by lessonAssetUploads through a
// server-issued, immutable upload ticket. Existing documents/files are kept.
exports.processLessonPdfIncomingUpload = onObjectFinalized(
  {
    region: "asia-northeast3",
    bucket: storageBucket,
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async () => undefined,
);
