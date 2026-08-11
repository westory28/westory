const { HttpsError } = require("firebase-functions/v2/https");

const ADAPTER_VERSION = "legacyPointV1";

const fail = (code, message, reason, details = {}) => {
  throw new HttpsError(code, message, { reason, ...details });
};

const createLegacyPointV1CommandAdapter = ({
  db,
  getPointWalletPath,
  getPointPolicyPath,
  getPointTransactionsPath,
  getWisHallOfFamePath,
  ensureWallet,
  loadPolicy,
  getCurrentRankEarnedTotal,
  buildWalletBase,
  buildWalletRankState,
  createTransactionPayload,
  nowMillis = () => Date.now(),
}) => {
  const dependencies = [
    db,
    getPointWalletPath,
    getPointPolicyPath,
    getPointTransactionsPath,
    getWisHallOfFamePath,
    ensureWallet,
    loadPolicy,
    getCurrentRankEarnedTotal,
    buildWalletBase,
    buildWalletRankState,
    createTransactionPayload,
  ];
  if (dependencies.some((dependency) => !dependency)) {
    throw new Error("legacyPointV1 adapter dependencies are incomplete.");
  }

  return {
    adapterVersion: ADAPTER_VERSION,
    apply: async ({
      transaction,
      commandId,
      payload,
      receiptId,
      timestamp,
      actor,
    }) => {
      const nativeTransaction = transaction?.native;
      if (!nativeTransaction) {
        throw new Error("legacyPointV1 requires a native Firestore transaction.");
      }

      const configRef = db.doc("site_settings/config");
      const userRef = db.doc(`users/${payload.uid}`);
      const [configSnap, userSnap] = await Promise.all([
        nativeTransaction.get(configRef),
        nativeTransaction.get(userRef),
      ]);
      const config = configSnap.exists ? configSnap.data() || {} : {};
      if (
        String(config.year || "").trim() !== payload.year
        || String(config.semester || "").trim() !== payload.semester
      ) {
        fail(
          "failed-precondition",
          "Point adjustment is limited to the active semester.",
          "POINT_SCOPE_NOT_ACTIVE",
          { year: payload.year, semester: payload.semester },
        );
      }
      if (!userSnap.exists) {
        fail(
          "not-found",
          "Student user document does not exist.",
          "POINT_TARGET_NOT_FOUND",
          { uid: payload.uid },
        );
      }
      const profile = userSnap.data() || {};

      const { ref: walletRef, wallet } = await ensureWallet(
        nativeTransaction,
        payload.year,
        payload.semester,
        payload.uid,
        profile,
      );
      const policy = await loadPolicy(nativeTransaction, payload.year, payload.semester);
      const currentRankEarnedTotal = await getCurrentRankEarnedTotal(
        nativeTransaction,
        payload.year,
        payload.semester,
        payload.uid,
        wallet,
      );

      if (!policy.manualAdjustEnabled) {
        fail(
          "failed-precondition",
          "Manual point adjustment is disabled by policy.",
          "POINT_MANUAL_ADJUST_DISABLED",
        );
      }

      const nextBalance = Number(wallet.balance || 0) + payload.delta;
      const nextRankEarnedTotal = currentRankEarnedTotal + Math.max(0, payload.delta);
      if (!policy.allowNegativeBalance && nextBalance < 0) {
        fail(
          "failed-precondition",
          "Insufficient point balance.",
          "POINT_BALANCE_INSUFFICIENT",
        );
      }

      const transactionType = payload.mode === "reclaim"
        ? "manual_reclaim"
        : "manual_adjust";
      const transactionId = `manual_${receiptId.slice(4)}`;
      const sourceId = `command:${commandId}`;
      const transactionRef = db.doc(
        `${getPointTransactionsPath(payload.year, payload.semester)}/${transactionId}`,
      );
      const hallOfFameRef = db.doc(getWisHallOfFamePath(payload.year, payload.semester));

      nativeTransaction.set(walletRef, {
        ...buildWalletBase(payload.uid, profile),
        balance: nextBalance,
        earnedTotal: nextRankEarnedTotal,
        ...buildWalletRankState(nextRankEarnedTotal, policy.rankPolicy),
        spentTotal: Number(wallet.spentTotal || 0),
        adjustedTotal: Number(wallet.adjustedTotal || 0) + payload.delta,
        lastTransactionAt: timestamp,
      }, { merge: true });
      nativeTransaction.create(transactionRef, createTransactionPayload({
        uid: payload.uid,
        type: transactionType,
        delta: payload.delta,
        balanceAfter: nextBalance,
        sourceId,
        sourceLabel: payload.sourceLabel,
        policyId: payload.policyId,
        createdBy: actor.actorUid,
      }));
      nativeTransaction.set(hallOfFameRef, {
        sourceUpdatedAt: timestamp,
        sourceUpdatedAtMs: nowMillis(),
      }, { merge: true });

      return {
        target: {
          adapterVersion: ADAPTER_VERSION,
          year: payload.year,
          semester: payload.semester,
          uid: payload.uid,
          refs: [
            configRef.path,
            userRef.path,
            getPointPolicyPath(payload.year, payload.semester),
            walletRef.path,
            transactionRef.path,
            hallOfFameRef.path,
          ],
        },
        sourceHash: null,
        result: {
          walletId: walletRef.id,
          transactionId,
          balance: nextBalance,
          type: transactionType,
        },
      };
    },
  };
};

const createRetiredAdjustTeacherPointsHandler = ({ assertPointManager }) => {
  if (typeof assertPointManager !== "function") {
    throw new Error("assertPointManager is required.");
  }
  return async (request) => {
    await assertPointManager(request, { recentAuth: true, highRisk: true });
    fail(
      "failed-precondition",
      "This client must be updated before adjusting points.",
      "CLIENT_UPDATE_REQUIRED",
    );
  };
};

module.exports = {
  ADAPTER_VERSION,
  createLegacyPointV1CommandAdapter,
  createRetiredAdjustTeacherPointsHandler,
};
