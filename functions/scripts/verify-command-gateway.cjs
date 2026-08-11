const assert = require("node:assert/strict");
const { HttpsError } = require("firebase-functions/v2/https");

const {
  ADMIN_EMAIL,
  AUDIT_COLLECTION,
  COMMAND_TYPES,
  RECEIPT_COLLECTION,
  buildHolidayDocumentId,
  buildReceiptId,
  createCallableExports,
  createCommandGatewayCore,
} = require("../commandGateway");
const {
  createLegacyPointV1CommandAdapter,
  createRetiredAdjustTeacherPointsHandler,
} = require("../legacyPointV1CommandAdapter");

const deepClone = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

class MemoryStore {
  constructor(seed = {}) {
    this.documents = new Map(
      Object.entries(seed).map(([path, data]) => [path, deepClone(data)]),
    );
    this.committedWrites = new Map();
    this.transactionCalls = 0;
    this.queryReads = 0;
    this.failNextCommit = false;
    this.lock = Promise.resolve();
  }

  async get(path) {
    this.queryReads += 1;
    return {
      exists: this.documents.has(path),
      data: deepClone(this.documents.get(path) || null),
      path,
    };
  }

  async runTransaction(callback) {
    this.transactionCalls += 1;
    let release;
    const previous = this.lock;
    this.lock = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    const working = new Map(
      Array.from(this.documents.entries(), ([path, data]) => [path, deepClone(data)]),
    );
    const writes = [];
    const transaction = {
      get: async (path) => ({
        exists: working.has(path),
        data: deepClone(working.get(path) || null),
        path,
      }),
      query: async (collectionPath, filter = null) => {
        const prefix = `${collectionPath}/`;
        return Array.from(working.entries())
          .filter(([path, data]) =>
            path.startsWith(prefix)
            && !path.slice(prefix.length).includes("/")
            && (!filter || (
              filter.operator === "=="
              && data?.[filter.field] === filter.value
            )))
          .map(([path, data]) => ({ exists: true, data: deepClone(data), path }));
      },
      set: (path, data, options) => {
        const next = options?.merge
          ? { ...(working.get(path) || {}), ...deepClone(data) }
          : deepClone(data);
        working.set(path, next);
        writes.push(path);
      },
      create: (path, data) => {
        if (working.has(path)) throw new Error(`Document already exists: ${path}`);
        working.set(path, deepClone(data));
        writes.push(path);
      },
      delete: (path) => {
        working.delete(path);
        writes.push(path);
      },
    };
    const toPath = (reference) => typeof reference === "string" ? reference : reference.path;
    transaction.native = {
      get: async (reference) => {
        const path = toPath(reference);
        const snapshot = await transaction.get(path);
        return {
          exists: snapshot.exists,
          id: path.split("/").pop(),
          ref: reference,
          data: () => deepClone(snapshot.data),
        };
      },
      set: (reference, data, options) => transaction.set(toPath(reference), data, options),
      create: (reference, data) => transaction.create(toPath(reference), data),
      delete: (reference) => transaction.delete(toPath(reference)),
    };

    try {
      const result = await callback(transaction);
      if (this.failNextCommit) {
        this.failNextCommit = false;
        throw new Error("SIMULATED_COMMIT_FAILURE");
      }
      this.documents = working;
      writes.forEach((path) => {
        this.committedWrites.set(path, (this.committedWrites.get(path) || 0) + 1);
      });
      return result;
    } finally {
      release();
    }
  }

  data(path) {
    return deepClone(this.documents.get(path));
  }

  has(path) {
    return this.documents.has(path);
  }

  writesTo(path) {
    return this.committedWrites.get(path) || 0;
  }
}

const requestFor = ({
  uid = "admin-uid",
  email = ADMIN_EMAIL,
  commandId,
  commandType,
  payload,
  sessionRevision = "session-revision-a",
  extra = {},
}) => ({
  auth: { uid, token: { email, auth_time: 1_786_400_000 } },
  data: {
    commandId,
    commandType,
    payload,
    _session: {
      authorityGeneration: "test-generation",
      protocolVersion: 2,
      revision: sessionRevision,
    },
    ...extra,
  },
});

const getReason = async (operation) => {
  try {
    await operation();
  } catch (error) {
    return error?.details?.reason || error?.code || error?.message || String(error);
  }
  throw new Error("Expected operation to reject.");
};

const main = async () => {
  const store = new MemoryStore({
    "site_settings/config": {
      year: "2026",
      semester: "2",
      availableSemesters: [
        { year: "2026", semester: "2", shellReady: true },
      ],
    },
    "years/2026/semesters/2/calendar/general_event": {
      title: "개학일",
      eventType: "school",
    },
    "years/2026/semesters/2/calendar/holiday_old": {
      title: "이전 공휴일",
      eventType: "holiday",
    },
    "site_settings/consent/items/legacy_first": {
      title: "기존 동의 1",
      order: 2,
    },
    "site_settings/consent/items/legacy_last": {
      title: "기존 동의 2",
      order: 7,
    },
    "users/point-student": {
      role: "student",
      studentName: "포인트 학생",
      studentGrade: "2",
      studentClass: "3",
      studentNumber: "7",
    },
    "years/2026/semesters/2/point_policies/current": {
      manualAdjustEnabled: true,
      allowNegativeBalance: false,
      rankPolicy: { basedOn: "earnedTotal" },
    },
    "years/2026/semesters/2/point_wallets/point-student": {
      uid: "point-student",
      balance: 10,
      earnedTotal: 10,
      rankEarnedTotal: 10,
      spentTotal: 0,
      adjustedTotal: 0,
    },
  });
  let authCalls = 0;
  const assertSession = async (request, options) => {
    authCalls += 1;
    assert.deepEqual(options, { recentAuth: true, highRisk: true });
    if (request.auth?.uid === "expired-uid") {
      throw new HttpsError("unauthenticated", "expired", {
        reason: "SESSION_EXPIRED",
      });
    }
    return {
      uid: request.auth?.uid,
      email: request.auth?.token?.email,
      authTime: request.auth?.token?.auth_time,
      authorityMode: "ENFORCE",
      observedFailure: null,
      sessionRef: { path: `application_sessions/${request.auth?.uid}/sessions/test` },
      session: {
        authorityGeneration: "test-generation",
        protocolVersion: 2,
        sessionRevision: request.data?._session?.revision || "",
      },
    };
  };
  const fakeDb = {
    doc: (path) => ({ path, id: path.split("/").pop() }),
  };
  const pointAdapter = createLegacyPointV1CommandAdapter({
    db: fakeDb,
    getPointWalletPath: (year, semester, uid) =>
      `years/${year}/semesters/${semester}/point_wallets/${uid}`,
    getPointPolicyPath: (year, semester) =>
      `years/${year}/semesters/${semester}/point_policies/current`,
    getPointTransactionsPath: (year, semester) =>
      `years/${year}/semesters/${semester}/point_transactions`,
    getWisHallOfFamePath: (year, semester) =>
      `years/${year}/semesters/${semester}/point_public/hall_of_fame`,
    ensureWallet: async (transaction, year, semester, uid, profile) => {
      const ref = fakeDb.doc(`years/${year}/semesters/${semester}/point_wallets/${uid}`);
      const snapshot = await transaction.get(ref);
      return {
        ref,
        wallet: snapshot.exists
          ? snapshot.data()
          : {
              uid,
              studentName: profile.studentName || "",
              balance: 0,
              earnedTotal: 0,
              rankEarnedTotal: 0,
              spentTotal: 0,
              adjustedTotal: 0,
            },
      };
    },
    loadPolicy: async (transaction, year, semester) => {
      const snapshot = await transaction.get(
        fakeDb.doc(`years/${year}/semesters/${semester}/point_policies/current`),
      );
      return snapshot.data();
    },
    getCurrentRankEarnedTotal: async (_transaction, _year, _semester, _uid, wallet) =>
      Number(wallet.rankEarnedTotal || 0),
    buildWalletBase: (uid, profile) => ({
      uid,
      studentName: profile.studentName || "",
      grade: profile.studentGrade || "",
      class: profile.studentClass || "",
      number: profile.studentNumber || "",
    }),
    buildWalletRankState: (rankEarnedTotal) => ({
      rankEarnedTotal,
      rankSnapshot: { metricValue: rankEarnedTotal },
    }),
    createTransactionPayload: (input) => ({ ...input, createdAt: "point-created-at" }),
    nowMillis: () => 1_786_400_123_000,
  });
  const authorizeCommand = async ({ request, identity, commandType }) => {
    if (commandType !== COMMAND_TYPES.ADJUST_TEACHER_POINTS) return null;
    if (identity.email === ADMIN_EMAIL) {
      return {
        actorUid: identity.uid,
        actorEmail: identity.email,
        actorRole: "admin",
        actorCapability: `command:${commandType}`,
      };
    }
    if (request.auth?.uid === "point-manager-uid") {
      return {
        actorUid: identity.uid,
        actorEmail: identity.email,
        actorRole: "teacher",
        actorCapability: "point_manage",
      };
    }
    throw new HttpsError("permission-denied", "point_manage required", {
      reason: "COMMAND_CAPABILITY_REQUIRED",
    });
  };
  let timestampCounter = 0;
  const core = createCommandGatewayCore({
    store,
    assertSession,
    authorizeCommand,
    commandAdapters: {
      [COMMAND_TYPES.ADJUST_TEACHER_POINTS]: pointAdapter,
    },
    serverTimestamp: () => `test-timestamp-${++timestampCounter}`,
    projectId: "demo-westory-session-command-gateway",
  });
  const callable = createCallableExports({ core });

  const termsId = "aaaaaaaa-1111-4111-8111-111111111111";
  const termsRequest = requestFor({
    commandId: termsId,
    commandType: COMMAND_TYPES.UPDATE_TERMS_SETTINGS,
    payload: { text: "<p>개정 이용 약관</p>" },
    extra: { actorUid: "untrusted-client-actor" },
  });
  const termsFirst = await callable.executeCommand.run(termsRequest);
  assert.deepEqual(termsFirst, {
    commandId: termsId,
    commandType: COMMAND_TYPES.UPDATE_TERMS_SETTINGS,
    status: "SUCCEEDED",
    replayed: false,
    result: {
      revision: termsFirst.result.revision,
      ref: "site_settings/terms",
    },
  });
  assert.equal(store.data("site_settings/terms").text, "<p>개정 이용 약관</p>");
  assert.equal(store.writesTo("site_settings/terms"), 1);
  const termsReceiptId = buildReceiptId(
    "admin-uid",
    COMMAND_TYPES.UPDATE_TERMS_SETTINGS,
    termsId,
  );
  const termsReceiptPath = `${RECEIPT_COLLECTION}/${termsReceiptId}`;
  const termsAuditPath = `${AUDIT_COLLECTION}/${termsReceiptId}`;
  const termsReceipt = store.data(termsReceiptPath);
  assert.equal(termsReceipt.schemaVersion, 1);
  assert.equal(termsReceipt.status, "SUCCEEDED");
  assert.equal(termsReceipt.actorUid, "admin-uid");
  assert.equal(termsReceipt.actorEmail, ADMIN_EMAIL);
  assert.equal(termsReceipt.actorRole, "admin");
  assert.equal(termsReceipt.actorCapability, "command:updateTermsSettings");
  assert.equal(termsReceipt.payloadHash.length, 64);
  assert.equal(termsReceipt.payloadHashAlgorithm, "sha256");
  assert.deepEqual(termsReceipt.target, { refs: ["site_settings/terms"] });
  assert.deepEqual(termsReceipt.result, termsFirst.result);
  assert.equal(termsReceipt.retryable, false);
  assert.equal(termsReceipt.checkpoint, "COMMITTED");
  assert.equal(termsReceipt.createdAt, termsReceipt.completedAt);
  assert.equal(termsReceipt.error, null);
  assert.equal(termsReceipt.session.ref, "application_sessions/admin-uid/sessions/test");
  assert.equal(termsReceipt.session.authTime, 1_786_400_000);
  assert.equal(termsReceipt.session.authorityMode, "ENFORCE");
  assert.equal(termsReceipt.session.authorityGeneration, "test-generation");
  assert.equal(termsReceipt.session.protocolVersion, 2);
  assert.equal(termsReceipt.session.revisionHash.length, 64);
  assert.equal(termsReceipt.audit.ref, termsAuditPath);
  const termsAudit = store.data(termsAuditPath);
  assert.equal(termsAudit.schemaVersion, 1);
  assert.equal(termsAudit.eventType, "COMMAND_SUCCEEDED");
  assert.equal(termsAudit.receiptRef, termsReceiptPath);
  assert.equal(termsAudit.commandId, termsId);
  assert.equal(termsAudit.commandType, COMMAND_TYPES.UPDATE_TERMS_SETTINGS);
  assert.equal(termsAudit.actorUid, "admin-uid");
  assert.equal(termsAudit.actorEmail, ADMIN_EMAIL);
  assert.equal(termsAudit.actorRole, "admin");
  assert.equal(termsAudit.actorCapability, "command:updateTermsSettings");
  assert.deepEqual(termsAudit.target, termsReceipt.target);
  assert.deepEqual(termsAudit.result, termsFirst.result);
  assert.equal(termsAudit.payloadHash, termsReceipt.payloadHash);
  assert.equal(termsAudit.createdAt, termsReceipt.createdAt);

  const termsReplay = await callable.executeCommand.run(
    requestFor({
      commandId: termsId.toUpperCase(),
      commandType: COMMAND_TYPES.UPDATE_TERMS_SETTINGS,
      payload: { text: "<p>개정 이용 약관</p>" },
      sessionRevision: "a-new-session-proof-excluded-from-hash",
    }),
  );
  assert.equal(termsReplay.replayed, true);
  assert.equal(termsReplay.commandId, termsId);
  assert.deepEqual(termsReplay.result, termsFirst.result);
  assert.equal(store.writesTo("site_settings/terms"), 1);

  const unregisteredScopeWritesBefore = Array.from(store.committedWrites.values())
    .reduce((sum, count) => sum + count, 0);
  assert.equal(
    await getReason(() => callable.executeCommand.run(
      requestFor({
        commandId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        commandType: COMMAND_TYPES.SYNC_KOREAN_PUBLIC_HOLIDAYS,
        payload: {
          year: "2099",
          semester: "1",
          holidays: [{
            title: "등록되지 않은 학기",
            start: "2099-01-01",
            eventType: "holiday",
            source: "generated",
          }],
        },
      }),
    )),
    "HOLIDAY_SCOPE_NOT_CONFIGURED",
  );
  assert.equal(
    Array.from(store.committedWrites.values()).reduce((sum, count) => sum + count, 0),
    unregisteredScopeWritesBefore,
  );
  assert.equal(
    await getReason(() => callable.executeCommand.run(
      requestFor({
        commandId: termsId,
        commandType: COMMAND_TYPES.UPDATE_TERMS_SETTINGS,
        payload: { text: "<p>서로 다른 내용</p>" },
      }),
    )),
    "COMMAND_ID_CONFLICT",
  );
  assert.equal(store.writesTo("site_settings/terms"), 1);

  const concurrentId = "22222222-2222-4222-8222-222222222222";
  const concurrentRequest = requestFor({
    commandId: concurrentId,
    commandType: COMMAND_TYPES.UPDATE_TERMS_SETTINGS,
    payload: { text: "<p>동시 요청</p>" },
  });
  const concurrentResults = await Promise.all([
    callable.executeCommand.run(concurrentRequest),
    callable.executeCommand.run(concurrentRequest),
    callable.executeCommand.run(concurrentRequest),
  ]);
  assert.deepEqual(
    concurrentResults.map((result) => result.replayed).sort(),
    [false, true, true],
  );
  assert.equal(store.writesTo("site_settings/terms"), 2);

  const responseLossId = "33333333-3333-4333-8333-333333333333";
  const responseLossRequest = requestFor({
    commandId: responseLossId,
    commandType: COMMAND_TYPES.UPDATE_TERMS_SETTINGS,
    payload: { text: "<p>응답 유실 뒤 복구</p>" },
  });
  responseLossRequest.data._testDropResponseAfterCommit = true;
  assert.equal(
    await getReason(() => callable.executeCommand.run(responseLossRequest)),
    "TEST_RESPONSE_LOSS",
  );
  const recovered = await callable.executeCommand.run(responseLossRequest);
  assert.equal(recovered.replayed, true);
  assert.equal(recovered.result.ref, "site_settings/terms");

  const productionCore = createCommandGatewayCore({
    store: new MemoryStore(),
    assertSession,
    serverTimestamp: () => "production-test-timestamp",
    projectId: "history-quiz-yongsin",
  });
  assert.equal(
    await getReason(() => productionCore.execute(
      requestFor({
        commandId: "88888888-8888-4888-8888-888888888888",
        commandType: COMMAND_TYPES.UPDATE_TERMS_SETTINGS,
        payload: { text: "운영 환경 fault injection 금지" },
        extra: { _testDropResponseAfterCommit: true },
      }),
    )),
    "TEST_FAULT_INJECTION_FORBIDDEN",
  );

  const consentId = "44444444-4444-4444-8444-444444444444";
  const consentRequest = requestFor({
    commandId: consentId,
    commandType: COMMAND_TYPES.ADD_CONSENT_ITEM,
    payload: {
      title: "필수 개인정보 동의",
      text: "<p>수집 목적과 보유 기간을 확인했습니다.</p>",
      required: true,
    },
  });
  const consentFirst = await callable.executeCommand.run(consentRequest);
  assert.equal(consentFirst.replayed, false);
  assert.equal(consentFirst.result.item.title, "필수 개인정보 동의");
  assert.equal(consentFirst.result.item.order, 8);
  assert.equal(consentFirst.result.revision.length, 64);
  const consentItemPath = `site_settings/consent/items/${consentFirst.result.item.id}`;
  assert.equal(store.data(consentItemPath).required, true);
  assert.equal(store.data("site_settings/consent").revision, consentFirst.result.revision);
  assert.equal(store.data("site_settings/consent").nextItemOrder, 9);
  const consentReplay = await callable.executeCommand.run(consentRequest);
  assert.equal(consentReplay.replayed, true);
  assert.equal(consentReplay.result.item.id, consentFirst.result.item.id);
  assert.equal(store.writesTo(consentItemPath), 1);

  const consentTransactionsBeforeRejectedOrder = store.transactionCalls;
  assert.equal(
    await getReason(() => callable.executeCommand.run(
      requestFor({
        commandId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        commandType: COMMAND_TYPES.ADD_CONSENT_ITEM,
        payload: {
          title: "클라이언트 순서 거부",
          text: "<p>순서는 서버가 결정합니다.</p>",
          required: true,
          order: 99,
        },
      }),
    )),
    "COMMAND_PAYLOAD_INVALID",
  );
  assert.equal(store.transactionCalls, consentTransactionsBeforeRejectedOrder);

  const concurrentConsentRequests = [
    requestFor({
      commandId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      commandType: COMMAND_TYPES.ADD_CONSENT_ITEM,
      payload: {
        title: "동시 동의 A",
        text: "<p>A</p>",
        required: true,
      },
    }),
    requestFor({
      commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      commandType: COMMAND_TYPES.ADD_CONSENT_ITEM,
      payload: {
        title: "동시 동의 B",
        text: "<p>B</p>",
        required: false,
      },
    }),
  ];
  const concurrentConsentResults = await Promise.all(
    concurrentConsentRequests.map((request) => callable.executeCommand.run(request)),
  );
  assert.deepEqual(
    concurrentConsentResults.map((result) => result.result.item.order).sort((a, b) => a - b),
    [9, 10],
  );
  assert.equal(store.data("site_settings/consent").nextItemOrder, 11);

  const updateConsentId = "10101010-1010-4010-8010-101010101010";
  const updateConsentRequest = requestFor({
    commandId: updateConsentId,
    commandType: COMMAND_TYPES.UPDATE_CONSENT_ITEM,
    payload: {
      itemId: "legacy_first",
      title: "개정한 기존 동의",
      text: "<p>개정 내용</p>",
      required: false,
      expectedRevision: null,
    },
  });
  const updateConsentFirst = await callable.executeCommand.run(updateConsentRequest);
  assert.equal(updateConsentFirst.replayed, false);
  assert.equal(updateConsentFirst.result.item.id, "legacy_first");
  assert.equal(updateConsentFirst.result.item.order, 2);
  assert.equal(updateConsentFirst.result.revision.length, 64);
  assert.equal(store.data("site_settings/consent/items/legacy_first").title, "개정한 기존 동의");
  assert.equal(
    store.data("site_settings/consent/items/legacy_first").revision,
    updateConsentFirst.result.revision,
  );
  const updateConsentReplay = await callable.executeCommand.run(updateConsentRequest);
  assert.equal(updateConsentReplay.replayed, true);
  assert.deepEqual(updateConsentReplay.result, updateConsentFirst.result);
  assert.equal(store.writesTo("site_settings/consent/items/legacy_first"), 1);
  assert.equal(
    await getReason(() => callable.executeCommand.run(
      requestFor({
        commandId: updateConsentId,
        commandType: COMMAND_TYPES.UPDATE_CONSENT_ITEM,
        payload: {
          ...updateConsentRequest.data.payload,
          title: "같은 ID의 다른 내용",
        },
      }),
    )),
    "COMMAND_ID_CONFLICT",
  );
  assert.equal(
    await getReason(() => callable.executeCommand.run(
      requestFor({
        commandId: "11111111-1010-4010-8010-101010101010",
        commandType: COMMAND_TYPES.UPDATE_CONSENT_ITEM,
        payload: {
          ...updateConsentRequest.data.payload,
          title: "오래된 revision",
        },
      }),
    )),
    "CONSENT_REVISION_CONFLICT",
  );

  const concurrentUpdateId = "12121212-1212-4212-8212-121212121212";
  const concurrentUpdateRequest = requestFor({
    commandId: concurrentUpdateId,
    commandType: COMMAND_TYPES.UPDATE_CONSENT_ITEM,
    payload: {
      itemId: consentFirst.result.item.id,
      title: "동시에 한 번만 개정",
      text: "<p>동시 개정</p>",
      required: true,
      expectedRevision: consentFirst.result.revision,
    },
  });
  const concurrentUpdates = await Promise.all([
    callable.executeCommand.run(concurrentUpdateRequest),
    callable.executeCommand.run(concurrentUpdateRequest),
    callable.executeCommand.run(concurrentUpdateRequest),
  ]);
  assert.deepEqual(
    concurrentUpdates.map((result) => result.replayed).sort(),
    [false, true, true],
  );
  assert.equal(store.writesTo(consentItemPath), 2);

  const deleteConsentId = "13131313-1313-4313-8313-131313131313";
  const deleteConsentRequest = requestFor({
    commandId: deleteConsentId,
    commandType: COMMAND_TYPES.DELETE_CONSENT_ITEM,
    payload: {
      itemId: "legacy_last",
      expectedRevision: null,
    },
    extra: { _testDropResponseAfterCommit: true },
  });
  assert.equal(
    await getReason(() => callable.executeCommand.run(deleteConsentRequest)),
    "TEST_RESPONSE_LOSS",
  );
  assert.equal(store.has("site_settings/consent/items/legacy_last"), false);
  const tombstonePath = "site_settings/consent/deleted_items/legacy_last";
  const tombstone = store.data(tombstonePath);
  assert.equal(tombstone.itemId, "legacy_last");
  assert.equal(tombstone.item.title, "기존 동의 2");
  assert.equal(tombstone.deletedBy, "admin-uid");
  assert.equal(tombstone.commandId, deleteConsentId);
  const deleteConsentReplay = await callable.executeCommand.run(deleteConsentRequest);
  assert.equal(deleteConsentReplay.replayed, true);
  assert.equal(deleteConsentReplay.result.tombstoneRef, tombstonePath);
  assert.equal(store.writesTo(tombstonePath), 1);
  assert.equal(store.writesTo("site_settings/consent/items/legacy_last"), 1);
  const deleteReceiptId = buildReceiptId(
    "admin-uid",
    COMMAND_TYPES.DELETE_CONSENT_ITEM,
    deleteConsentId,
  );
  const deleteReceipt = store.data(`${RECEIPT_COLLECTION}/${deleteReceiptId}`);
  assert.equal(deleteReceipt.status, "SUCCEEDED");
  assert.equal(deleteReceipt.actorRole, "admin");
  assert.equal(deleteReceipt.actorCapability, "command:deleteConsentItem");
  assert.equal(deleteReceipt.checkpoint, "COMMITTED");
  assert.equal(deleteReceipt.error, null);
  assert.equal(deleteReceipt.session.revisionHash.length, 64);
  assert.deepEqual(deleteReceipt.result, deleteConsentReplay.result);

  const holidayId = "55555555-5555-4555-8555-555555555555";
  const holidayPayload = {
    year: 2026,
    semester: "2",
    holidays: [
      {
        title: "추석",
        start: "2026-09-25",
        eventType: "holiday",
        source: "generated",
      },
      {
        title: "개천절",
        start: "2026-10-03",
        eventType: "holiday",
        source: "kasi",
      },
    ],
  };
  const holidayFirst = await callable.executeCommand.run(
    requestFor({
      commandId: holidayId,
      commandType: COMMAND_TYPES.SYNC_KOREAN_PUBLIC_HOLIDAYS,
      payload: holidayPayload,
    }),
  );
  assert.equal(holidayFirst.result.count, 2);
  assert.equal(holidayFirst.result.sourceHash.length, 64);
  assert.equal(store.has("years/2026/semesters/2/calendar/general_event"), true);
  assert.equal(store.has("years/2026/semesters/2/calendar/holiday_old"), false);
  holidayPayload.holidays.forEach((holiday) => {
    const documentId = buildHolidayDocumentId(holiday);
    const document = store.data(`years/2026/semesters/2/calendar/${documentId}`);
    assert.equal(document.eventType, "holiday");
    assert.equal(document.holidaySource, holiday.source);
  });
  const holidayReceiptId = buildReceiptId(
    "admin-uid",
    COMMAND_TYPES.SYNC_KOREAN_PUBLIC_HOLIDAYS,
    holidayId,
  );
  assert.equal(
    store.data(`${RECEIPT_COLLECTION}/${holidayReceiptId}`).sourceHash,
    holidayFirst.result.sourceHash,
  );
  const reorderedReplay = await callable.executeCommand.run(
    requestFor({
      commandId: holidayId,
      commandType: COMMAND_TYPES.SYNC_KOREAN_PUBLIC_HOLIDAYS,
      payload: { ...holidayPayload, holidays: [...holidayPayload.holidays].reverse() },
    }),
  );
  assert.equal(reorderedReplay.replayed, true);

  const pointCommandId = "14141414-1414-4414-8414-141414141414";
  const pointRequest = requestFor({
    uid: "point-manager-uid",
    email: "point.manager@yongshin-ms.ms.kr",
    commandId: pointCommandId,
    commandType: COMMAND_TYPES.ADJUST_TEACHER_POINTS,
    payload: {
      year: "2026",
      semester: "2",
      uid: "point-student",
      delta: 5,
      sourceLabel: "수업 참여 보상",
      policyId: "manual-policy",
      mode: "grant",
    },
  });
  const pointFirst = await callable.executeCommand.run(pointRequest);
  assert.equal(pointFirst.replayed, false);
  assert.equal(pointFirst.result.balance, 15);
  assert.equal(pointFirst.result.type, "manual_adjust");
  const pointReceiptId = buildReceiptId(
    "point-manager-uid",
    COMMAND_TYPES.ADJUST_TEACHER_POINTS,
    pointCommandId,
  );
  const pointTransactionPath =
    `years/2026/semesters/2/point_transactions/manual_${pointReceiptId.slice(4)}`;
  const pointTransaction = store.data(pointTransactionPath);
  assert.equal(pointTransaction.sourceId, `command:${pointCommandId}`);
  assert.equal(pointTransaction.createdBy, "point-manager-uid");
  assert.equal(store.data("years/2026/semesters/2/point_wallets/point-student").balance, 15);
  assert.equal(store.writesTo("years/2026/semesters/2/point_public/hall_of_fame"), 1);
  const pointReceipt = store.data(`${RECEIPT_COLLECTION}/${pointReceiptId}`);
  assert.equal(pointReceipt.schemaVersion, 1);
  assert.equal(pointReceipt.status, "SUCCEEDED");
  assert.equal(pointReceipt.actorUid, "point-manager-uid");
  assert.equal(pointReceipt.actorEmail, "point.manager@yongshin-ms.ms.kr");
  assert.equal(pointReceipt.actorRole, "teacher");
  assert.equal(pointReceipt.actorCapability, "point_manage");
  assert.equal(pointReceipt.target.adapterVersion, "legacyPointV1");
  assert.equal(pointReceipt.target.refs.includes(pointTransactionPath), true);
  assert.equal(pointReceipt.payloadHash.length, 64);
  assert.equal(pointReceipt.session.revisionHash.length, 64);
  assert.deepEqual(pointReceipt.result, pointFirst.result);
  assert.equal(pointReceipt.error, null);
  assert.equal(pointReceipt.retryable, false);
  assert.equal(pointReceipt.checkpoint, "COMMITTED");
  assert.equal(pointReceipt.audit.ref, `${AUDIT_COLLECTION}/${pointReceiptId}`);
  const pointAudit = store.data(`${AUDIT_COLLECTION}/${pointReceiptId}`);
  assert.equal(pointAudit.actorUid, "point-manager-uid");
  assert.equal(pointAudit.actorRole, "teacher");
  assert.equal(pointAudit.actorCapability, "point_manage");
  assert.deepEqual(pointAudit.target, pointReceipt.target);
  assert.deepEqual(pointAudit.result, pointFirst.result);
  assert.equal(pointAudit.payloadHash, pointReceipt.payloadHash);
  const pointReplay = await callable.executeCommand.run(pointRequest);
  assert.equal(pointReplay.replayed, true);
  assert.deepEqual(pointReplay.result, pointFirst.result);
  assert.equal(store.writesTo(pointTransactionPath), 1);
  assert.equal(
    await getReason(() => callable.executeCommand.run(
      requestFor({
        commandId: pointCommandId,
        commandType: COMMAND_TYPES.ADJUST_TEACHER_POINTS,
        uid: "point-manager-uid",
        email: "point.manager@yongshin-ms.ms.kr",
        payload: { ...pointRequest.data.payload, delta: 6 },
      }),
    )),
    "COMMAND_ID_CONFLICT",
  );

  const concurrentPointId = "15151515-1515-4515-8515-151515151515";
  const concurrentPointRequest = requestFor({
    uid: "point-manager-uid",
    email: "point.manager@yongshin-ms.ms.kr",
    commandId: concurrentPointId,
    commandType: COMMAND_TYPES.ADJUST_TEACHER_POINTS,
    payload: {
      year: "2026",
      semester: "2",
      uid: "point-student",
      delta: 3,
      sourceLabel: "동시 요청",
      policyId: "",
      mode: "grant",
    },
  });
  const concurrentPointResults = await Promise.all([
    callable.executeCommand.run(concurrentPointRequest),
    callable.executeCommand.run(concurrentPointRequest),
    callable.executeCommand.run(concurrentPointRequest),
  ]);
  assert.deepEqual(
    concurrentPointResults.map((result) => result.replayed).sort(),
    [false, true, true],
  );
  assert.equal(store.data("years/2026/semesters/2/point_wallets/point-student").balance, 18);

  const pointLossId = "16161616-1616-4616-8616-161616161616";
  const pointLossRequest = requestFor({
    uid: "point-manager-uid",
    email: "point.manager@yongshin-ms.ms.kr",
    commandId: pointLossId,
    commandType: COMMAND_TYPES.ADJUST_TEACHER_POINTS,
    payload: {
      year: "2026",
      semester: "2",
      uid: "point-student",
      delta: -2,
      sourceLabel: "오지급 환수",
      mode: "reclaim",
    },
    extra: { _testDropResponseAfterCommit: true },
  });
  assert.equal(
    await getReason(() => callable.executeCommand.run(pointLossRequest)),
    "TEST_RESPONSE_LOSS",
  );
  assert.equal(store.data("years/2026/semesters/2/point_wallets/point-student").balance, 16);
  const pointLossReplay = await callable.executeCommand.run(pointLossRequest);
  assert.equal(pointLossReplay.replayed, true);
  assert.equal(pointLossReplay.result.balance, 16);

  const adminPointId = "21212121-2121-4121-8121-212121212121";
  const adminPointResult = await callable.executeCommand.run(
    requestFor({
      commandId: adminPointId,
      commandType: COMMAND_TYPES.ADJUST_TEACHER_POINTS,
      payload: {
        year: "2026",
        semester: "2",
        uid: "point-student",
        delta: 1,
        sourceLabel: "관리자 직접 지급",
        mode: "grant",
      },
    }),
  );
  assert.equal(adminPointResult.result.balance, 17);
  const adminPointReceiptId = buildReceiptId(
    "admin-uid",
    COMMAND_TYPES.ADJUST_TEACHER_POINTS,
    adminPointId,
  );
  const adminPointReceipt = store.data(`${RECEIPT_COLLECTION}/${adminPointReceiptId}`);
  assert.equal(adminPointReceipt.actorRole, "admin");
  assert.equal(adminPointReceipt.actorCapability, "command:adjustTeacherPoints");

  const pointWritesBeforeRejection = Array.from(store.committedWrites.values())
    .reduce((sum, count) => sum + count, 0);
  assert.equal(
    await getReason(() => callable.executeCommand.run(
      requestFor({
        uid: "teacher-without-point-permission",
        email: "teacher@yongshin-ms.ms.kr",
        commandId: "17171717-1717-4717-8717-171717171717",
        commandType: COMMAND_TYPES.ADJUST_TEACHER_POINTS,
        payload: pointRequest.data.payload,
      }),
    )),
    "COMMAND_CAPABILITY_REQUIRED",
  );
  assert.equal(
    Array.from(store.committedWrites.values()).reduce((sum, count) => sum + count, 0),
    pointWritesBeforeRejection,
  );
  assert.equal(
    await getReason(() => callable.executeCommand.run(
      requestFor({
        uid: "expired-uid",
        email: "expired@yongshin-ms.ms.kr",
        commandId: "18181818-1818-4818-8818-181818181818",
        commandType: COMMAND_TYPES.ADJUST_TEACHER_POINTS,
        payload: pointRequest.data.payload,
      }),
    )),
    "SESSION_EXPIRED",
  );
  assert.equal(
    await getReason(() => callable.executeCommand.run(
      requestFor({
        uid: "point-manager-uid",
        email: "point.manager@yongshin-ms.ms.kr",
        commandId: "19191919-1919-4919-8919-191919191919",
        commandType: COMMAND_TYPES.ADJUST_TEACHER_POINTS,
        payload: { ...pointRequest.data.payload, year: "2025", semester: "1" },
      }),
    )),
    "POINT_SCOPE_NOT_ACTIVE",
  );
  assert.equal(store.data("years/2026/semesters/2/point_wallets/point-student").balance, 17);

  const transactionCallsBeforeDuplicateManifest = store.transactionCalls;
  assert.equal(
    await getReason(() => callable.executeCommand.run(
      requestFor({
        commandId: "99999999-9999-4999-8999-999999999999",
        commandType: COMMAND_TYPES.SYNC_KOREAN_PUBLIC_HOLIDAYS,
        payload: {
          year: "2026",
          semester: "2",
          holidays: [holidayPayload.holidays[0], holidayPayload.holidays[0]],
        },
      }),
    )),
    "HOLIDAY_MANIFEST_DUPLICATE",
  );
  assert.equal(store.transactionCalls, transactionCallsBeforeDuplicateManifest);

  const collisionHoliday = {
    title: "한글날",
    start: "2026-10-09",
    eventType: "holiday",
    source: "generated",
  };
  const collisionPath = `years/2026/semesters/2/calendar/${buildHolidayDocumentId(collisionHoliday)}`;
  const collisionStore = new MemoryStore({
    "site_settings/config": {
      year: "2026",
      semester: "2",
    },
    [collisionPath]: { title: "수동 일정", eventType: "school" },
  });
  const collisionCore = createCommandGatewayCore({
    store: collisionStore,
    assertSession,
    serverTimestamp: () => "collision-test-timestamp",
    projectId: "demo-westory-session-command-gateway",
  });
  const collisionCommandId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.equal(
    await getReason(() => collisionCore.execute(
      requestFor({
        commandId: collisionCommandId,
        commandType: COMMAND_TYPES.SYNC_KOREAN_PUBLIC_HOLIDAYS,
        payload: {
          year: "2026",
          semester: "2",
          holidays: [collisionHoliday],
        },
      }),
    )),
    "HOLIDAY_DOCUMENT_ID_CONFLICT",
  );
  assert.deepEqual(collisionStore.data(collisionPath), {
    title: "수동 일정",
    eventType: "school",
  });
  assert.equal(collisionStore.documents.size, 2);

  const statusWritesBefore = Array.from(store.committedWrites.values())
    .reduce((sum, count) => sum + count, 0);
  const statusResult = await callable.getCommandStatus.run(
    requestFor({
      commandId: consentId,
      commandType: COMMAND_TYPES.ADD_CONSENT_ITEM,
      payload: undefined,
    }),
  );
  assert.deepEqual(statusResult, {
    commandId: consentId,
    commandType: COMMAND_TYPES.ADD_CONSENT_ITEM,
    status: "SUCCEEDED",
    replayed: true,
    result: consentFirst.result,
  });
  const statusWritesAfter = Array.from(store.committedWrites.values())
    .reduce((sum, count) => sum + count, 0);
  assert.equal(statusWritesAfter, statusWritesBefore);
  const pointStatus = await callable.getCommandStatus.run(
    requestFor({
      uid: "point-manager-uid",
      email: "point.manager@yongshin-ms.ms.kr",
      commandId: pointCommandId,
      commandType: COMMAND_TYPES.ADJUST_TEACHER_POINTS,
      payload: undefined,
    }),
  );
  assert.equal(pointStatus.status, "SUCCEEDED");
  assert.equal(pointStatus.replayed, true);
  assert.deepEqual(pointStatus.result, pointFirst.result);

  const transactionCallsBeforeRejection = store.transactionCalls;
  assert.equal(
    await getReason(() => callable.executeCommand.run(
      requestFor({
        uid: "expired-uid",
        commandId: "not-even-a-valid-command-id",
        commandType: COMMAND_TYPES.UPDATE_TERMS_SETTINGS,
        payload: { text: "should never be parsed" },
      }),
    )),
    "SESSION_EXPIRED",
  );
  assert.equal(store.transactionCalls, transactionCallsBeforeRejection);
  assert.equal(
    await getReason(() => callable.executeCommand.run(
      requestFor({
        uid: "teacher-uid",
        email: "teacher@yongshin-ms.ms.kr",
        commandId: "66666666-6666-4666-8666-666666666666",
        commandType: COMMAND_TYPES.UPDATE_TERMS_SETTINGS,
        payload: { text: "권한 없음" },
      }),
    )),
    "COMMAND_ADMIN_REQUIRED",
  );
  assert.equal(store.transactionCalls, transactionCallsBeforeRejection);
  const readsBeforeUnauthorizedStatus = store.queryReads;
  assert.equal(
    await getReason(() => callable.getCommandStatus.run(
      requestFor({
        uid: "teacher-uid",
        email: "teacher@yongshin-ms.ms.kr",
        commandId: consentId,
        commandType: COMMAND_TYPES.ADD_CONSENT_ITEM,
        payload: undefined,
      }),
    )),
    "COMMAND_ADMIN_REQUIRED",
  );
  assert.equal(store.queryReads, readsBeforeUnauthorizedStatus);

  const failedStore = new MemoryStore();
  failedStore.failNextCommit = true;
  const failedCore = createCommandGatewayCore({
    store: failedStore,
    assertSession,
    serverTimestamp: () => "failed-transaction-timestamp",
  });
  const failedId = "77777777-7777-4777-8777-777777777777";
  await assert.rejects(
    () => failedCore.execute(
      requestFor({
        commandId: failedId,
        commandType: COMMAND_TYPES.ADD_CONSENT_ITEM,
        payload: {
          title: "원자성 검증",
          text: "<p>commit 전에는 어느 문서도 보여서는 안 됩니다.</p>",
          required: true,
        },
      }),
    ),
    /SIMULATED_COMMIT_FAILURE/,
  );
  const failedReceiptId = buildReceiptId(
    "admin-uid",
    COMMAND_TYPES.ADD_CONSENT_ITEM,
    failedId,
  );
  assert.equal(failedStore.documents.size, 0);
  assert.equal(failedStore.has(`${RECEIPT_COLLECTION}/${failedReceiptId}`), false);
  assert.equal(failedStore.has(`${AUDIT_COLLECTION}/${failedReceiptId}`), false);

  const failedDeleteStore = new MemoryStore({
    "site_settings/consent/items/delete_failure": {
      title: "삭제 실패 원자성",
      text: "<p>보존되어야 합니다.</p>",
      required: true,
      order: 1,
    },
  });
  failedDeleteStore.failNextCommit = true;
  const failedDeleteCore = createCommandGatewayCore({
    store: failedDeleteStore,
    assertSession,
    serverTimestamp: () => "failed-delete-transaction-timestamp",
  });
  const failedDeleteId = "22222222-2020-4020-8020-202020202020";
  await assert.rejects(
    () => failedDeleteCore.execute(
      requestFor({
        commandId: failedDeleteId,
        commandType: COMMAND_TYPES.DELETE_CONSENT_ITEM,
        payload: { itemId: "delete_failure", expectedRevision: null },
      }),
    ),
    /SIMULATED_COMMIT_FAILURE/,
  );
  assert.equal(failedDeleteStore.has("site_settings/consent/items/delete_failure"), true);
  assert.equal(
    failedDeleteStore.has("site_settings/consent/deleted_items/delete_failure"),
    false,
  );
  const failedDeleteReceiptId = buildReceiptId(
    "admin-uid",
    COMMAND_TYPES.DELETE_CONSENT_ITEM,
    failedDeleteId,
  );
  assert.equal(
    failedDeleteStore.has(`${RECEIPT_COLLECTION}/${failedDeleteReceiptId}`),
    false,
  );
  assert.equal(
    failedDeleteStore.has(`${AUDIT_COLLECTION}/${failedDeleteReceiptId}`),
    false,
  );

  const failedPointStore = new MemoryStore({
    "site_settings/config": { year: "2026", semester: "2" },
    "users/point-student": { role: "student", studentName: "원자성 학생" },
    "years/2026/semesters/2/point_policies/current": {
      manualAdjustEnabled: true,
      allowNegativeBalance: false,
      rankPolicy: {},
    },
    "years/2026/semesters/2/point_wallets/point-student": {
      uid: "point-student",
      balance: 20,
      earnedTotal: 20,
      rankEarnedTotal: 20,
      spentTotal: 0,
      adjustedTotal: 0,
    },
  });
  failedPointStore.failNextCommit = true;
  const failedPointCore = createCommandGatewayCore({
    store: failedPointStore,
    assertSession,
    authorizeCommand,
    commandAdapters: {
      [COMMAND_TYPES.ADJUST_TEACHER_POINTS]: pointAdapter,
    },
    serverTimestamp: () => "failed-point-transaction-timestamp",
  });
  const failedPointId = "20202020-2020-4020-8020-202020202020";
  await assert.rejects(
    () => failedPointCore.execute(
      requestFor({
        uid: "point-manager-uid",
        email: "point.manager@yongshin-ms.ms.kr",
        commandId: failedPointId,
        commandType: COMMAND_TYPES.ADJUST_TEACHER_POINTS,
        payload: pointRequest.data.payload,
      }),
    ),
    /SIMULATED_COMMIT_FAILURE/,
  );
  assert.equal(
    failedPointStore.data("years/2026/semesters/2/point_wallets/point-student").balance,
    20,
  );
  assert.equal(
    failedPointStore.has("years/2026/semesters/2/point_public/hall_of_fame"),
    false,
  );
  const failedPointReceiptId = buildReceiptId(
    "point-manager-uid",
    COMMAND_TYPES.ADJUST_TEACHER_POINTS,
    failedPointId,
  );
  assert.equal(
    failedPointStore.has(`${RECEIPT_COLLECTION}/${failedPointReceiptId}`),
    false,
  );
  assert.equal(
    failedPointStore.has(`${AUDIT_COLLECTION}/${failedPointReceiptId}`),
    false,
  );

  let retiredAuthorizationCalls = 0;
  const retiredHandler = createRetiredAdjustTeacherPointsHandler({
    assertPointManager: async (_request, options) => {
      retiredAuthorizationCalls += 1;
      assert.deepEqual(options, { recentAuth: true, highRisk: true });
    },
  });
  assert.equal(
    await getReason(() => retiredHandler(requestFor({}))),
    "CLIENT_UPDATE_REQUIRED",
  );
  assert.equal(retiredAuthorizationCalls, 1);
  const rejectedRetiredHandler = createRetiredAdjustTeacherPointsHandler({
    assertPointManager: async () => {
      throw new HttpsError("unauthenticated", "expired", { reason: "SESSION_EXPIRED" });
    },
  });
  assert.equal(
    await getReason(() => rejectedRetiredHandler(requestFor({}))),
    "SESSION_EXPIRED",
  );

  assert.ok(authCalls >= 15);
  console.log(JSON.stringify({
    suite: "command-gateway-core",
    passed: true,
    cases: [
      "FIRST_SUCCESS_ATOMIC_RECEIPT_BUSINESS_AUDIT",
      "SEQUENTIAL_REPLAY",
      "COMMAND_ID_CASE_CANONICAL_REPLAY",
      "COMMAND_ID_CONFLICT",
      "CONCURRENT_DUPLICATE_EFFECT_ONCE",
      "RESPONSE_LOSS_REPLAY",
      "DEMO_ONLY_RESPONSE_LOSS_FAULT_INJECTION",
      "UNTRUSTED_CLIENT_ACTOR_IGNORED",
      "UNAUTHORIZED_PRE_BUSINESS_REJECTION",
      "EXPIRED_SESSION_PRE_BUSINESS_REJECTION",
      "TERMS_ATOMIC_RESULT",
      "CONSENT_SERVER_ASSIGNED_ORDER_AND_METADATA_COUNTER",
      "CONSENT_CONCURRENT_DISTINCT_COMMAND_ORDER_SERIALIZATION",
      "CONSENT_CLIENT_ORDER_REJECTED",
      "CONSENT_UPDATE_CAS_REPLAY_CONFLICT_AND_CONCURRENT_EFFECT_ONCE",
      "CONSENT_DELETE_TOMBSTONE_ATOMIC_RESPONSE_LOSS_REPLAY",
      "CONSENT_DELETE_COMMIT_FAILURE_ZERO_PARTIAL_WRITES",
      "HOLIDAY_SCHEMA_SOURCE_HASH_AND_GENERAL_EVENT_PRESERVATION",
      "HOLIDAY_UNREGISTERED_SCOPE_REJECTED",
      "HOLIDAY_DUPLICATE_AND_DOCUMENT_ID_COLLISION_REJECTED",
      "POINT_LEGACY_V1_DETERMINISTIC_LEDGER_ATOMIC_RECEIPT_AUDIT_HOF",
      "POINT_MANAGER_CAPABILITY_AND_ACTIVE_SCOPE_FENCE",
      "POINT_CONCURRENT_DUPLICATE_CONFLICT_RESPONSE_LOSS_REPLAY",
      "POINT_COMMIT_FAILURE_ZERO_PARTIAL_WRITES",
      "RETIRED_POINT_CALLABLE_AUTHORIZED_NO_WRITE_CLIENT_UPDATE_REQUIRED",
      "QUERY_ONLY_STATUS_AUTH_AND_ZERO_WRITES",
      "SIMULATED_COMMIT_FAILURE_ZERO_PARTIAL_WRITES",
    ],
    productionAccess: 0,
  }));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
