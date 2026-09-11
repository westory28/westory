const { createHash, randomUUID } = require("node:crypto");
const COLLECTION = "history_dictionary_notification_outbox";

// Called inside the business transaction, after all target reads. The key uses
// the pending request's stored version so a reopened request is a new event.
const buildResolutionEvent = ({ requestId, requestData, uid, year, semester, word, termId, actorUid, timestamp }) => {
  const id = createHash("sha256").update(JSON.stringify([
    "resolved", requestId, requestData.updatedAt || requestData.createdAt || null,
    requestData.status || "requested", uid, year, semester, termId,
  ])).digest("hex");
  return { path: `${COLLECTION}/${id}`, data: {
    id, uid, year, semester, status: "PENDING", attempts: 0,
    nextAttemptAtMs: 0, createdAt: timestamp,
    notification: {
      type: "history_dictionary_resolved", title: "역사 사전 등록 완료",
      body: `요청한 "${word}" 뜻풀이가 등록되었습니다.`,
      targetUrl: "/student/lesson/history-dictionary",
      entityType: "history_dictionary_term", entityId: termId,
      actorUid, priority: "normal", dedupeKey: `history_dictionary_event:${id}`,
      templateValues: { word },
    },
  } };
};

const createDictionaryNotificationDelivery = ({ db, deliver, now = Date.now, deleteField }) => async (paths) => {
  const candidates = paths
    ? [...new Set(paths)].slice(0, 100).map(path => {
        if (!new RegExp(`^${COLLECTION}/[a-f0-9]{64}$`).test(path)) throw new Error("Invalid dictionary outbox path");
        return db.doc(path);
      })
    : (await db.collection(COLLECTION).where("nextAttemptAtMs", "<=", now()).limit(50).get()).docs.map(doc => doc.ref);
  let delivered = 0, deferred = 0;
  for (const ref of candidates) {
    const lease = randomUUID();
    const event = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref), data = snapshot.data();
      if (!snapshot.exists || data.status === "DELIVERED" || data.nextAttemptAtMs > now()) return null;
      transaction.set(ref, { status: "DELIVERING", lease, attempts: Number(data.attempts || 0) + 1, nextAttemptAtMs: now() + 180000 }, { merge: true });
      return data;
    });
    if (!event) continue;
    let failed = false;
    try { await deliver(event.year, event.semester, event.uid, event.notification); }
    catch { failed = true; }
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.data().lease !== lease) return;
      transaction.set(ref, failed
        ? { status: "PENDING", nextAttemptAtMs: now() + Math.min(1800000, 30000 * 2 ** Math.min(Number(event.attempts || 0), 6)), lastError: "DELIVERY_RETRY_REQUIRED" }
        : { status: "DELIVERED", deliveredAtMs: now(), nextAttemptAtMs: deleteField(), lastError: "" }, { merge: true });
    });
    if (failed) deferred++; else delivered++;
  }
  return { delivered, deferred };
};

module.exports = { COLLECTION, buildResolutionEvent, createDictionaryNotificationDelivery };
