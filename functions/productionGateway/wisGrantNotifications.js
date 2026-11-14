const { createHash } = require("node:crypto");

const TYPE = "wis_granted";
const CONFIG_PATH = "site_settings/notification_config";
const text = (value, maximum, fallback = "") =>
  (String(value ?? "").replace(/\s+/g, " ").trim() || fallback).slice(0, maximum);
const render = (template, fallback, values) => {
  const source = String(template || "").trim();
  if (!source || [...source.matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .some(match => !Object.prototype.hasOwnProperty.call(values, match[1]))) return fallback;
  return source.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => values[key]) || fallback;
};
const noOp = () => ({ refs: [], apply() {} });

// The caller prepares this before ledger writes and commits the notification,
// unread counter, payment and receipt together. No trigger or retry worker is
// needed, and automatic assessment rewards never call this manual-grant helper.
const prepareWisGrantNotification = async ({ transaction, account, amount, reason,
  ledgerEntryId, actor, timestamp, concreteTimestamp }) => {
  const configSnapshot = await transaction.get(CONFIG_PATH);
  const config = configSnapshot.data || {};
  const policy = config.eventPolicies?.[TYPE] || {};
  if (config.enabled === false || config.studentNotificationsEnabled === false || policy.enabled === false)
    return noOp();

  const [year, semester] = account.semesterId.split("-");
  const uid = account.studentUid;
  const dedupeKey = `${TYPE}:${ledgerEntryId}`;
  const id = `n_${createHash("sha1").update(dedupeKey).digest("hex")}`;
  const inboxPath = `years/${year}/semesters/${semester}/notification_inboxes/${uid}`;
  const itemPath = `${inboxPath}/items/${id}`;
  const [existing, inbox] = await transaction.getAll([itemPath, inboxPath]);
  if (existing.exists) return noOp();

  const values = { amount: amount.toLocaleString("ko-KR"), reason,
    balance: (account.balance + amount).toLocaleString("ko-KR") };
  const at = concreteTimestamp || timestamp;
  const milliseconds = typeof at?.toMillis === "function" ? at.toMillis()
    : at instanceof Date ? at.getTime() : Date.parse(at);
  if (!Number.isFinite(milliseconds)) throw new Error("A concrete Wis grant notification timestamp is required.");
  const targetUrl = /\{([a-zA-Z0-9_]+)\}/.test(String(policy.targetUrl || ""))
    ? render(policy.targetUrl, "/student/points", values) : "/student/points";
  const item = {
    type: TYPE,
    title: text(render(policy.titleTemplate, "위스가 지급되었습니다", values), 80, "알림"),
    body: text(render(policy.bodyTemplate, `${reason} · ${values.amount}위스 지급`, values), 500),
    targetUrl: text(targetUrl, 240), entityType: "wis_ledger", entityId: ledgerEntryId,
    actorUid: actor.actorUid, recipientUid: uid,
    priority: policy.priority === "high" ? "high" : "normal", dedupeKey,
    readAt: null, createdAt: timestamp, expiresAt: new Date(milliseconds + 30 * 86400_000),
  };
  return { refs: [itemPath], apply() {
    transaction.create(itemPath, item);
    transaction.set(inboxPath, { uid, unreadCount: Math.max(0, Number(inbox.data?.unreadCount) || 0) + 1,
      updatedAt: timestamp }, { merge: true });
  } };
};

module.exports = { TYPE, prepareWisGrantNotification };
