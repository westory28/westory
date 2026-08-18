const assert = require("node:assert/strict");
const wis = require("../wisEconomy");
const archiveEnrollment = require("../archiveEnrollment");

class MemoryTransaction {
  constructor(seed = {}) {
    this.documents = new Map(
      Object.entries(seed).map(([path, data]) => [path, structuredClone(data)]),
    );
    this.readStats = {
      documentReads: 0,
      queryCalls: 0,
      queryDocuments: 0,
      maxQueryDocuments: 0,
    };
  }
  async get(path) {
    this.readStats.documentReads += 1;
    return {
      exists: this.documents.has(path),
      data: this.documents.has(path)
        ? structuredClone(this.documents.get(path))
        : null,
      path,
    };
  }
  async getAll(paths) {
    this.readStats.documentReads += paths.length;
    return paths.map((path) => ({
      exists: this.documents.has(path),
      data: this.documents.has(path)
        ? structuredClone(this.documents.get(path))
        : null,
      path,
    }));
  }
  async query(collection, filter = null) {
    const prefix = `${collection}/`;
    const compare = (left, operator, right) => {
      if (operator === "==") return left === right;
      if (operator === ">") return left > right;
      if (operator === ">=") return left >= right;
      if (operator === "<") return left < right;
      if (operator === "<=") return left <= right;
      return false;
    };
    const clauses = Array.isArray(filter?.filters)
      ? filter.filters
      : filter?.field
        ? [filter]
        : [];
    let rows = [...this.documents.entries()]
      .filter(
        ([path]) =>
          path.startsWith(prefix) && !path.slice(prefix.length).includes("/"),
      )
      .map(([path, data]) => ({
        exists: true,
        path,
        data: structuredClone(data),
      }))
      .filter((row) =>
        clauses.every((clause) =>
          compare(
            row.data?.[clause.field],
            clause.operator || "==",
            clause.value,
          ),
        ),
      );
    const orderings = Array.isArray(filter?.orderBy)
      ? filter.orderBy
      : filter?.orderBy
        ? [filter.orderBy]
        : [];
    if (orderings.length) {
      rows.sort((left, right) => {
        for (const ordering of orderings) {
          const direction = ordering.direction === "desc" ? -1 : 1;
          const comparison = String(
            left.data?.[ordering.field] ?? "",
          ).localeCompare(String(right.data?.[ordering.field] ?? ""));
          if (comparison) return comparison * direction;
        }
        const documentDirection = filter?.documentIdOrder === "desc" ? -1 : 1;
        return left.path.localeCompare(right.path) * documentDirection;
      });
    } else if (filter?.documentIdOrder) {
      const direction = filter.documentIdOrder === "desc" ? -1 : 1;
      rows.sort(
        (left, right) => left.path.localeCompare(right.path) * direction,
      );
    }
    if (filter?.startAfterId) {
      const cursorPath = `${prefix}${filter.startAfterId}`;
      const direction = filter.documentIdOrder === "desc" ? -1 : 1;
      rows = rows.filter(
        (row) => row.path.localeCompare(cursorPath) * direction > 0,
      );
    }
    if (filter?.startAfterPath) {
      const cursorIndex = rows.findIndex(
        (row) => row.path === filter.startAfterPath,
      );
      rows = cursorIndex >= 0 ? rows.slice(cursorIndex + 1) : [];
    }
    if (Number.isSafeInteger(filter?.limit) && filter.limit > 0) {
      rows = rows.slice(0, filter.limit);
    }
    this.readStats.queryCalls += 1;
    this.readStats.queryDocuments += rows.length;
    this.readStats.maxQueryDocuments = Math.max(
      this.readStats.maxQueryDocuments,
      rows.length,
    );
    return rows;
  }
  set(path, data, options) {
    const current = this.documents.get(path) || {};
    this.documents.set(
      path,
      structuredClone(options?.merge ? { ...current, ...data } : data),
    );
  }
  create(path, data) {
    if (this.documents.has(path)) throw new Error(`already exists: ${path}`);
    this.documents.set(path, structuredClone(data));
  }
  delete(path) {
    this.documents.delete(path);
  }
}

const actor = {
  actorUid: "teacher-1",
  actorRole: "teacher",
  actorEmail: "teacher@yongshin-ms.ms.kr",
};
const student = {
  actorUid: "student-1",
  actorRole: "student",
  actorEmail: "student@yongshin-ms.ms.kr",
};
const manifest = { semesterId: "2026-2", revision: 7, status: "ACTIVE" };
const enrollment = {
  enrollmentId: "enrollment-1",
  semesterId: "2026-2",
  studentUid: "student-1",
  classId: "class-1",
  displayName: "합성 학생",
  studentNumber: "7",
  status: "ACTIVE",
  enrollmentStatus: "ACTIVE",
};
const enrollmentSlotId = archiveEnrollment.buildEnrollmentSlotId(
  "2026-2",
  "student-1",
);
const tx = new MemoryTransaction({
  "semester_manifests/2026-2": manifest,
  "semester_enrollments/enrollment-1": enrollment,
  [`semester_enrollment_slots/${enrollmentSlotId}`]: {
    semesterId: "2026-2",
    studentUid: "student-1",
    activeEnrollmentId: "enrollment-1",
  },
  "semester_classes/class-1": {
    classId: "class-1",
    semesterId: "2026-2",
    grade: "2",
    classNumber: "3",
    status: "ACTIVE",
  },
});
const adapter = wis.createWisCommandAdapter();
let commandIndex = 0;
const apply = async (commandType, payload, targetActor = actor) =>
  adapter.apply({
    transaction: tx,
    commandId: `command-${++commandIndex}`,
    commandType,
    payload: wis.normalizeWisPayload(commandType, payload),
    receiptId: `receipt-${commandIndex}`,
    timestamp: `timestamp-${commandIndex}`,
    actor: targetActor,
  });
const common = { semesterId: "2026-2", expectedSemesterRevision: 7 };

const run = async () => {
  const created = await apply("createSemesterEconomy", {
    ...common,
    displayName: "2026학년도 2학기 위스",
    currencyName: "위스",
    initialGrantAmount: 500,
  });
  assert.equal(created.result.status, "ACTIVE_INITIALIZING");

  const accounts = await apply("createWisAccounts", {
    ...common,
    expectedEconomyRevision: 1,
    enrollmentIds: ["enrollment-1"],
    reason: "계정 생성",
  });
  assert.equal(accounts.result.createdCount, 1);
  const accountId = wis.accountIdFor("2026-2", "student-1");
  assert.equal(
    (await tx.get(`semester_wis_accounts/${accountId}`)).data.balance,
    0,
  );

  await assert.rejects(
    () =>
      apply("grantInitialWis", {
        ...common,
        expectedEconomyRevision: 2,
        accountId,
        expectedAccountRevision: 1,
        amount: 100,
        sourceId: "invalid-initial",
        reason: "정책과 다른 최초 지급",
      }),
    (error) => error.details?.reason === "WIS_INITIAL_GRANT_AMOUNT_MISMATCH",
  );
  assert.equal(
    (await tx.get(`semester_wis_accounts/${accountId}`)).data.balance,
    0,
  );
  assert.equal(
    (
      await tx.query("semester_wis_ledger", {
        field: "accountId",
        value: accountId,
      })
    ).length,
    0,
  );

  const initial = await apply("grantInitialWis", {
    ...common,
    expectedEconomyRevision: 2,
    accountId,
    expectedAccountRevision: 1,
    amount: 500,
    sourceId: "initial-2026-2",
    reason: "최초 지급",
  });
  assert.equal(initial.result.balance, 500);
  assert.deepEqual(
    (({ earnedTotal, rankEarnedTotal, spentTotal, adjustedTotal }) => ({
      earnedTotal,
      rankEarnedTotal,
      spentTotal,
      adjustedTotal,
    }))((await tx.get(`semester_wis_accounts/${accountId}`)).data),
    {
      earnedTotal: 500,
      rankEarnedTotal: 0,
      spentTotal: 0,
      adjustedTotal: 0,
    },
  );
  const ledgerCountBeforeInitialReverse = (
    await tx.query("semester_wis_ledger", {
      field: "accountId",
      value: accountId,
    })
  ).length;
  await assert.rejects(
    () =>
      apply("reverseWisEntry", {
        ...common,
        expectedEconomyRevision: 2,
        accountId,
        expectedAccountRevision: 2,
        ledgerEntryId: initial.result.ledgerEntryId,
        reason: "최초 지급 역분개 금지",
      }),
    (error) => error.details?.reason === "WIS_REVERSAL_INVALID",
  );
  assert.equal(
    (
      await tx.query("semester_wis_ledger", {
        field: "accountId",
        value: accountId,
      })
    ).length,
    ledgerCountBeforeInitialReverse,
  );
  await assert.rejects(
    () =>
      apply("grantInitialWis", {
        ...common,
        expectedEconomyRevision: 2,
        accountId,
        expectedAccountRevision: 2,
        amount: 500,
        sourceId: "other-initial",
        reason: "중복",
      }),
    (error) => error.details?.reason === "WIS_INITIAL_GRANT_ALREADY_APPLIED",
  );

  const opened = await apply("transitionWisEconomy", {
    ...common,
    expectedEconomyRevision: 2,
    targetStatus: "ACTIVE_OPEN",
    reason: "운영 시작",
  });
  assert.equal(opened.result.status, "ACTIVE_OPEN");

  const grant = await apply("grantWis", {
    ...common,
    expectedEconomyRevision: 3,
    accountId,
    expectedAccountRevision: 2,
    amount: 100,
    sourceId: "lesson-1",
    reason: "수업 참여",
  });
  assert.equal(grant.result.balance, 600);
  assert.deepEqual(
    (({ earnedTotal, rankEarnedTotal, spentTotal, adjustedTotal }) => ({
      earnedTotal,
      rankEarnedTotal,
      spentTotal,
      adjustedTotal,
    }))((await tx.get(`semester_wis_accounts/${accountId}`)).data),
    {
      earnedTotal: 600,
      rankEarnedTotal: 100,
      spentTotal: 0,
      adjustedTotal: 100,
    },
  );
  await assert.rejects(
    () =>
      apply("grantWis", {
        ...common,
        expectedEconomyRevision: 3,
        accountId,
        expectedAccountRevision: 3,
        amount: 100,
        sourceId: "lesson-1",
        reason: "중복",
      }),
    (error) => error.details?.reason === "WIS_LEDGER_SOURCE_EXISTS",
  );
  await assert.rejects(
    () =>
      apply("deductWis", {
        ...common,
        expectedEconomyRevision: 3,
        accountId,
        expectedAccountRevision: 3,
        amount: 1000,
        sourceId: "too-much",
        reason: "초과 회수",
      }),
    (error) => error.details?.reason === "WIS_INSUFFICIENT_BALANCE",
  );

  const originalLedgerBeforeReversal = (
    await tx.get(`semester_wis_ledger/${grant.result.ledgerEntryId}`)
  ).data;
  const reverse = await apply("reverseWisEntry", {
    ...common,
    expectedEconomyRevision: 3,
    accountId,
    expectedAccountRevision: 3,
    ledgerEntryId: grant.result.ledgerEntryId,
    reason: "오지급 취소",
  });
  assert.equal(reverse.result.balance, 500);
  assert.deepEqual(
    (({ earnedTotal, rankEarnedTotal, spentTotal, adjustedTotal }) => ({
      earnedTotal,
      rankEarnedTotal,
      spentTotal,
      adjustedTotal,
    }))((await tx.get(`semester_wis_accounts/${accountId}`)).data),
    {
      earnedTotal: 500,
      rankEarnedTotal: 0,
      spentTotal: 0,
      adjustedTotal: 0,
    },
  );
  assert.deepEqual(
    (await tx.get(`semester_wis_ledger/${grant.result.ledgerEntryId}`)).data,
    originalLedgerBeforeReversal,
  );
  const ledgerCountBeforeReversalOfReversal = (
    await tx.query("semester_wis_ledger", {
      field: "accountId",
      value: accountId,
    })
  ).length;
  await assert.rejects(
    () =>
      apply("reverseWisEntry", {
        ...common,
        expectedEconomyRevision: 3,
        accountId,
        expectedAccountRevision: 4,
        ledgerEntryId: reverse.result.ledgerEntryId,
        reason: "재환수 금지",
      }),
    (error) => error.details?.reason === "WIS_REVERSAL_INVALID",
  );
  assert.equal(
    (
      await tx.query("semester_wis_ledger", {
        field: "accountId",
        value: accountId,
      })
    ).length,
    ledgerCountBeforeReversalOfReversal,
  );
  tx.set("semester_wis_ledger/lesson-core-system-grant", {
    ledgerEntryId: "lesson-core-system-grant",
    semesterId: "2026-2",
    accountId,
    studentUid: "student-1",
    type: "GRANT",
    delta: 500,
    sourceId: "lesson-core-points-all",
    actorUid: "system",
    actorRole: "system",
  });
  await assert.rejects(
    () =>
      apply("reverseWisEntry", {
        ...common,
        expectedEconomyRevision: 3,
        accountId,
        expectedAccountRevision: 4,
        ledgerEntryId: "lesson-core-system-grant",
        reason: "핵심포인트 보상 역분개 금지",
      }),
    (error) => error.details?.reason === "WIS_REVERSAL_INVALID",
  );
  tx.delete("semester_wis_ledger/lesson-core-system-grant");
  await assert.rejects(
    () =>
      apply("reverseWisEntry", {
        ...common,
        expectedEconomyRevision: 3,
        accountId,
        expectedAccountRevision: 4,
        ledgerEntryId: grant.result.ledgerEntryId,
        reason: "중복 취소",
      }),
    (error) => error.details?.reason === "WIS_LEDGER_SOURCE_EXISTS",
  );

  const product = await apply("upsertWisProduct", {
    ...common,
    expectedEconomyRevision: 3,
    expectedProductRevision: null,
    name: "연필",
    description: "학습용 연필",
    imageUrl: "",
    active: true,
    reason: "상품 등록",
  });
  const inventory = await apply("upsertWisInventory", {
    ...common,
    expectedEconomyRevision: 3,
    productId: product.result.productId,
    expectedInventoryRevision: null,
    price: 100,
    stock: 2,
    active: true,
    reason: "재고 등록",
  });
  const order = await apply(
    "placeWisOrder",
    {
      ...common,
      expectedEconomyRevision: 3,
      inventoryId: inventory.result.inventoryId,
      expectedInventoryRevision: 1,
      expectedAccountRevision: 4,
      quantity: 1,
    },
    student,
  );
  assert.equal(order.result.balance, 400);
  assert.equal(
    (await tx.get(`semester_wis_accounts/${accountId}`)).data.spentTotal,
    100,
  );
  assert.equal(
    (await tx.get(`semester_wis_inventory/${inventory.result.inventoryId}`))
      .data.available,
    1,
  );
  await assert.rejects(
    () =>
      apply(
        "placeWisOrder",
        {
          ...common,
          expectedEconomyRevision: 3,
          inventoryId: inventory.result.inventoryId,
          expectedInventoryRevision: 2,
          expectedAccountRevision: 5,
          quantity: 5,
        },
        student,
      ),
    (error) => error.details?.reason === "WIS_INSUFFICIENT_STOCK",
  );
  const ledgerCountBeforeOrderDebitReverse = (
    await tx.query("semester_wis_ledger", {
      field: "accountId",
      value: accountId,
    })
  ).length;
  await assert.rejects(
    () =>
      apply("reverseWisEntry", {
        ...common,
        expectedEconomyRevision: 3,
        accountId,
        expectedAccountRevision: 5,
        ledgerEntryId: order.result.ledgerEntryId,
        reason: "주문 차감 역분개 금지",
      }),
    (error) => error.details?.reason === "WIS_REVERSAL_INVALID",
  );
  assert.equal(
    (
      await tx.query("semester_wis_ledger", {
        field: "accountId",
        value: accountId,
      })
    ).length,
    ledgerCountBeforeOrderDebitReverse,
  );

  const rejected = await apply("reviewWisOrder", {
    ...common,
    expectedEconomyRevision: 3,
    orderId: order.result.orderId,
    expectedOrderRevision: 1,
    action: "REJECT",
    reason: "합성 반려",
  });
  assert.equal(rejected.result.balance, 500);
  assert.equal(
    (await tx.get(`semester_wis_accounts/${accountId}`)).data.spentTotal,
    0,
  );
  assert.equal(
    (await tx.get(`semester_wis_inventory/${inventory.result.inventoryId}`))
      .data.available,
    2,
  );
  const ledgerCountBeforeRefundReverse = (
    await tx.query("semester_wis_ledger", {
      field: "accountId",
      value: accountId,
    })
  ).length;
  await assert.rejects(
    () =>
      apply("reverseWisEntry", {
        ...common,
        expectedEconomyRevision: 3,
        accountId,
        expectedAccountRevision: 6,
        ledgerEntryId: rejected.result.refundLedgerEntryId,
        reason: "주문 환불 역분개 금지",
      }),
    (error) => error.details?.reason === "WIS_REVERSAL_INVALID",
  );
  assert.equal(
    (
      await tx.query("semester_wis_ledger", {
        field: "accountId",
        value: accountId,
      })
    ).length,
    ledgerCountBeforeRefundReverse,
  );

  const renamedProduct = await apply("upsertWisProduct", {
    ...common,
    expectedEconomyRevision: 3,
    productId: product.result.productId,
    expectedProductRevision: 1,
    name: "새 이름 연필",
    description: "학습용 연필",
    imageUrl: "",
    active: true,
    reason: "상품명 변경",
  });
  assert.equal(renamedProduct.result.inventoryRevision, 4);
  tx.set(`semester_enrollments/${enrollment.enrollmentId}`, {
    ...enrollment,
    enrollmentStatus: "WITHDRAWN",
    status: "ACTIVE",
  });
  await assert.rejects(
    () =>
      apply(
        "placeWisOrder",
        {
          ...common,
          expectedEconomyRevision: 3,
          inventoryId: inventory.result.inventoryId,
          expectedInventoryRevision: 4,
          expectedAccountRevision: 6,
          quantity: 1,
        },
        student,
      ),
    (error) => error.details?.reason === "WIS_ACTIVE_ENROLLMENT_REQUIRED",
  );
  tx.set(`semester_enrollments/${enrollment.enrollmentId}`, enrollment);
  tx.set(`wis_product_catalog/${product.result.productId}`, {
    ...(await tx.get(`wis_product_catalog/${product.result.productId}`)).data,
    active: false,
  });
  await assert.rejects(
    () =>
      apply(
        "placeWisOrder",
        {
          ...common,
          expectedEconomyRevision: 3,
          inventoryId: inventory.result.inventoryId,
          expectedInventoryRevision: 4,
          expectedAccountRevision: 6,
          quantity: 1,
        },
        student,
      ),
    (error) => error.details?.reason === "WIS_PRODUCT_UNAVAILABLE",
  );
  tx.set(`wis_product_catalog/${product.result.productId}`, {
    ...(await tx.get(`wis_product_catalog/${product.result.productId}`)).data,
    active: true,
  });
  const renamedOrder = await apply(
    "placeWisOrder",
    {
      ...common,
      expectedEconomyRevision: 3,
      inventoryId: inventory.result.inventoryId,
      expectedInventoryRevision: 4,
      expectedAccountRevision: 6,
      quantity: 1,
    },
    student,
  );
  assert.equal(
    (await tx.get(`semester_wis_accounts/${accountId}`)).data.spentTotal,
    100,
  );
  const renamedOrderDocument = (
    await tx.get(`semester_wis_orders/${renamedOrder.result.orderId}`)
  ).data;
  assert.equal(renamedOrderDocument.productName, "새 이름 연필");
  assert.match(
    (await tx.get(`semester_wis_ledger/${renamedOrder.result.ledgerEntryId}`))
      .data.reason,
    /새 이름 연필/u,
  );

  const rebuild = await apply("rebuildWisProjection", {
    ...common,
    expectedEconomyRevision: 3,
    accountId,
    reason: "projection 대조",
  });
  assert.equal(rebuild.result.balance, 400);
  assert.equal(rebuild.result.status, "PASS");

  const savedHallConfig = await apply("saveWisHallOfFameConfig", {
    ...common,
    expectedEconomyRevision: 3,
    expectedHallOfFameRevision: 0,
    hallOfFame: {
      podiumImageUrl: "",
      podiumStoragePath: "",
      positionPreset: "classic_podium_v1",
      positions: {
        desktop: {
          first: { leftPercent: 50, topPercent: 26, widthPercent: 21 },
          second: { leftPercent: 26.5, topPercent: 40.5, widthPercent: 18 },
          third: { leftPercent: 73.5, topPercent: 40.5, widthPercent: 18 },
        },
        mobile: {
          first: { leftPercent: 50, topPercent: 28, widthPercent: 28 },
          second: { leftPercent: 28, topPercent: 46, widthPercent: 21 },
          third: { leftPercent: 72, topPercent: 46, widthPercent: 21 },
        },
      },
      leaderboardPanel: {
        desktop: { leftPercent: 71, topPercent: 0, widthPercent: 29 },
        mobile: { leftPercent: 50, topPercent: 0, widthPercent: 100 },
      },
      publicRange: {
        gradeRankLimit: 10,
        classRankLimit: 10,
        includeTies: true,
      },
      recognitionPopup: {
        enabled: true,
        gradeEnabled: true,
        classEnabled: true,
      },
    },
    reason: "화랑의 전당 설정 저장",
  });
  assert.equal(savedHallConfig.result.hallOfFameRevision, 1);
  assert.equal(
    (await tx.get("site_settings/interface_config")).data.hallOfFameRevision,
    1,
  );

  const newestLedgerEntries = [];
  let expectedAccountRevision = rebuild.result.accountRevision;
  for (const [sourceId, reason] of [
    ["ordering-zebra", "순서 검증 첫 번째"],
    ["ordering-apricot", "순서 검증 두 번째"],
    ["ordering-middle", "순서 검증 세 번째"],
  ]) {
    const nextGrant = await apply("grantWis", {
      ...common,
      expectedEconomyRevision: 3,
      accountId,
      expectedAccountRevision,
      amount: 1,
      sourceId,
      reason,
    });
    expectedAccountRevision = nextGrant.result.accountRevision;
    newestLedgerEntries.unshift(nextGrant.result.ledgerEntryId);
  }

  const store = {
    get: (path) => tx.get(path),
    runTransaction: (callback) => callback(tx),
  };
  const queryCore = wis.createWisQueryCore({
    store,
    assertSession: async (request) => ({
      uid: request.auth.uid,
      email: request.auth.token.email,
    }),
  });
  tx.set("users/student-1", { role: "student" });
  tx.set("users/teacher-1", {
    role: "teacher",
    staffPermissions: ["point_manage"],
  });
  tx.set("users/reader-1", {
    role: "teacher",
    staffPermissions: ["point_read"],
  });
  tx.set("users/delegated-1", {
    role: "student",
    staffPermissions: ["point_read"],
  });
  tx.set("semester_wis_rankings/foreign-ranking", {
    accountId: "foreign-account",
    semesterId: "2026-2",
    studentUid: "foreign-student-uid",
    displayName: "노출되면 안 되는 학생",
    balance: 999999,
  });
  const studentState = await queryCore.getWisEconomyState({
    auth: { uid: "student-1", token: { email: "student@yongshin-ms.ms.kr" } },
    data: { audience: "student", semesterId: "2026-2", source: "CURRENT" },
  });
  assert.equal(studentState.account.accountId, accountId);
  assert.equal(studentState.writeCount, 0);
  assert.equal(studentState.rankings.length, 1);
  assert.equal(studentState.rankings[0].studentUid, "student-1");
  assert.deepEqual(
    studentState.ledger.slice(0, 3).map((entry) => entry.ledgerEntryId),
    newestLedgerEntries,
  );
  assert.notDeepEqual(
    newestLedgerEntries,
    [...newestLedgerEntries].sort((left, right) => right.localeCompare(left)),
  );
  for (const entry of studentState.ledger) {
    for (const privateField of [
      "accountId",
      "studentUid",
      "actorUid",
      "actorRole",
      "commandId",
      "receiptId",
      "sourceId",
    ])
      assert.equal(Object.hasOwn(entry, privateField), false);
  }
  assert.doesNotMatch(
    JSON.stringify(studentState),
    /foreign-student-uid|노출되면 안 되는 학생/u,
  );
  tx.set("semester_classes/class-2", {
    classId: "class-2",
    semesterId: "2026-2",
    grade: "2",
    classNumber: "4",
    status: "ACTIVE",
  });
  tx.set("semester_enrollments/enrollment-other-class", {
    enrollmentId: "enrollment-other-class",
    semesterId: "2026-2",
    studentUid: "student-other-class",
    classId: "class-2",
    displayName: "다른 반 학생",
    studentNumber: "8",
    status: "ACTIVE",
    enrollmentStatus: "ACTIVE",
  });
  tx.set(
    `semester_enrollment_slots/${archiveEnrollment.buildEnrollmentSlotId("2026-2", "student-other-class")}`,
    {
      semesterId: "2026-2",
      studentUid: "student-other-class",
      activeEnrollmentId: "enrollment-other-class",
    },
  );
  tx.set("semester_wis_accounts/account-other-class", {
    accountId: "account-other-class",
    semesterId: "2026-2",
    studentUid: "student-other-class",
    enrollmentId: "enrollment-other-class",
    classId: "class-2",
    displayName: "다른 반 학생",
    revision: 1,
    balance: 250,
    rankEarnedTotal: 250,
  });
  const studentHallState = await queryCore.getWisEconomyState({
    auth: { uid: "student-1", token: { email: "student@yongshin-ms.ms.kr" } },
    data: {
      audience: "student",
      semesterId: "2026-2",
      source: "CURRENT",
      projection: "hall-of-fame",
    },
  });
  const publicHallJson = JSON.stringify(studentHallState.hallOfFame);
  assert.match(publicHallJson, /합\*\*/u);
  assert.doesNotMatch(
    publicHallJson,
    /student-1|wisacct_|"balance"|"studentUid"|"accountId"/u,
  );
  assert.deepEqual(
    Object.keys(studentHallState.hallOfFame.classLeaderboardByClassKey),
    ["2-3"],
  );
  assert.ok(
    studentHallState.hallOfFame.gradeLeaderboardByGrade["2"].length > 1,
  );
  tx.delete("semester_wis_accounts/account-other-class");
  tx.delete("semester_enrollments/enrollment-other-class");
  tx.delete(
    `semester_enrollment_slots/${archiveEnrollment.buildEnrollmentSlotId("2026-2", "student-other-class")}`,
  );
  tx.delete("semester_classes/class-2");
  const teacherState = await queryCore.getWisEconomyState({
    auth: { uid: "teacher-1", token: { email: "teacher@yongshin-ms.ms.kr" } },
    data: { audience: "teacher", semesterId: "2026-2", source: "CURRENT" },
  });
  assert.deepEqual(
    {
      grade: teacherState.accounts[0].grade,
      classNumber: teacherState.accounts[0].classNumber,
      studentNumber: teacherState.accounts[0].studentNumber,
    },
    { grade: "2", classNumber: "3", studentNumber: "7" },
  );
  const teacherAccountState = await queryCore.getWisEconomyState({
    auth: { uid: "teacher-1", token: { email: "teacher@yongshin-ms.ms.kr" } },
    data: {
      audience: "teacher",
      semesterId: "2026-2",
      source: "CURRENT",
      projection: "account",
      accountId,
      limit: 20,
    },
  });
  assert.deepEqual(
    teacherAccountState.ledger.slice(0, 3).map((entry) => entry.ledgerEntryId),
    newestLedgerEntries,
  );
  assert.equal("recentLedgerEntries" in teacherAccountState.accounts[0], false);
  const readOnlyTeacherState = await queryCore.getWisEconomyState({
    auth: { uid: "reader-1", token: { email: "reader@yongshin-ms.ms.kr" } },
    data: {
      audience: "teacher",
      semesterId: "2026-2",
      source: "CURRENT",
      projection: "overview",
      limit: 20,
    },
  });
  assert.equal(readOnlyTeacherState.readOnly, true);
  assert.equal(readOnlyTeacherState.accounts.length, 1);
  await assert.rejects(
    () =>
      queryCore.getWisEconomyState({
        auth: {
          uid: "delegated-1",
          token: { email: "delegated@yongshin-ms.ms.kr" },
        },
        data: {
          audience: "teacher",
          semesterId: "2026-2",
          source: "CURRENT",
        },
      }),
    (error) => error.details?.reason === "WIS_MANAGE_REQUIRED",
  );
  tx.set("users/delegated-1", {
    role: "student",
    teacherPortalEnabled: true,
    staffPermissions: ["point_read"],
  });
  assert.equal(
    (
      await queryCore.getWisEconomyState({
        auth: {
          uid: "delegated-1",
          token: { email: "delegated@yongshin-ms.ms.kr" },
        },
        data: {
          audience: "teacher",
          semesterId: "2026-2",
          source: "CURRENT",
          projection: "summary",
        },
      })
    ).readOnly,
    true,
  );

  const largeSeed = {
    "semester_manifests/2026-2": manifest,
    "semester_wis_economies/2026-2": {
      semesterId: "2026-2",
      revision: 3,
      status: "ACTIVE_OPEN",
    },
    "users/large-reader": {
      role: "teacher",
      staffPermissions: ["point_read"],
    },
    "semester_classes/large-class": {
      classId: "large-class",
      semesterId: "2026-2",
      grade: "2",
      classNumber: "3",
      status: "ACTIVE",
    },
  };
  for (let index = 0; index < 205; index += 1) {
    const suffix = String(index).padStart(3, "0");
    largeSeed[`semester_enrollments/enrollment-${suffix}`] = {
      enrollmentId: `enrollment-${suffix}`,
      semesterId: "2026-2",
      studentUid: `student-${suffix}`,
      classId: "large-class",
      displayName: `합성 학생 ${suffix}`,
      studentNumber: String(index + 1),
      status: "ACTIVE",
      enrollmentStatus: "ACTIVE",
    };
    largeSeed[
      `semester_enrollment_slots/${archiveEnrollment.buildEnrollmentSlotId("2026-2", `student-${suffix}`)}`
    ] = {
      semesterId: "2026-2",
      studentUid: `student-${suffix}`,
      activeEnrollmentId: `enrollment-${suffix}`,
    };
    largeSeed[`semester_wis_accounts/account-${suffix}`] = {
      accountId: `account-${suffix}`,
      semesterId: "2026-2",
      studentUid: `student-${suffix}`,
      enrollmentId: `enrollment-${suffix}`,
      classId: "large-class",
      displayName: `합성 학생 ${suffix}`,
      revision: 1,
      balance: index,
    };
  }
  const orderStudentUid = "order-student";
  const orderAccountId = wis.accountIdFor("2026-2", orderStudentUid);
  largeSeed[`users/${orderStudentUid}`] = { role: "student" };
  largeSeed["semester_enrollments/order-enrollment"] = {
    enrollmentId: "order-enrollment",
    semesterId: "2026-2",
    studentUid: orderStudentUid,
    classId: "large-class",
    displayName: "주문 학생",
    studentNumber: "999",
    status: "ACTIVE",
    enrollmentStatus: "ACTIVE",
  };
  largeSeed[
    `semester_enrollment_slots/${archiveEnrollment.buildEnrollmentSlotId("2026-2", orderStudentUid)}`
  ] = {
    semesterId: "2026-2",
    studentUid: orderStudentUid,
    activeEnrollmentId: "order-enrollment",
  };
  largeSeed[`semester_wis_accounts/${orderAccountId}`] = {
    accountId: orderAccountId,
    semesterId: "2026-2",
    studentUid: orderStudentUid,
    enrollmentId: "order-enrollment",
    classId: "large-class",
    displayName: "주문 학생",
    revision: 1,
    balance: 1_000,
  };
  const orderedOrders = [
    ["order-hash-z", "2026-08-18T09:00:00.000Z", "REQUESTED"],
    ["order-hash-a", "2026-08-18T08:00:00.000Z", "REJECTED"],
    ["order-hash-y", "2026-08-18T07:00:00.000Z", "REQUESTED"],
    ["order-hash-b", "2026-08-18T06:00:00.000Z", "REJECTED"],
    ["order-hash-x", "2026-08-18T05:00:00.000Z", "APPROVED"],
  ];
  for (const [orderId, createdAt, status] of orderedOrders) {
    largeSeed[`semester_wis_orders/${orderId}`] = {
      orderId,
      semesterId: "2026-2",
      accountId: orderAccountId,
      studentUid: orderStudentUid,
      productId: "product-order-fixture",
      productName: "순서 검증 상품",
      quantity: 1,
      unitPrice: 10,
      totalPrice: 10,
      revision: 1,
      status,
      reviewedBy: "private-teacher-uid",
      createdAt,
      updatedAt: createdAt,
    };
  }
  for (let index = 0; index < 205; index += 1) {
    const productId = `inactive-product-${String(index).padStart(3, "0")}`;
    largeSeed[`wis_product_catalog/${productId}`] = {
      productId,
      revision: 1,
      name: `숨김 상품 ${index}`,
      description: "",
      imageUrl: "",
      active: false,
    };
  }
  const activeProductId = "zz-active-product";
  largeSeed[`wis_product_catalog/${activeProductId}`] = {
    productId: activeProductId,
    revision: 1,
    name: "활성 상품",
    description: "",
    imageUrl: "",
    active: true,
    createdBy: "private-teacher-uid",
    updatedBy: "private-teacher-uid",
  };
  const activeInventoryId = wis.inventoryIdFor("2026-2", activeProductId);
  largeSeed[`semester_wis_inventory/${activeInventoryId}`] = {
    inventoryId: activeInventoryId,
    semesterId: "2026-2",
    productId: activeProductId,
    productName: "활성 상품",
    revision: 1,
    price: 10,
    stock: 5,
    available: 5,
    reserved: 0,
    sold: 0,
    active: true,
    updatedBy: "private-teacher-uid",
  };
  const largeTx = new MemoryTransaction(largeSeed);
  const largeQueryCore = wis.createWisQueryCore({
    store: {
      get: (path) => largeTx.get(path),
      runTransaction: (callback) => callback(largeTx),
    },
    assertSession: async (request) => ({
      uid: request.auth.uid,
      email: request.auth.token.email,
    }),
  });
  const largeRequest = (cursor = "") =>
    largeQueryCore.getWisEconomyState({
      auth: {
        uid: "large-reader",
        token: { email: "large-reader@yongshin-ms.ms.kr" },
      },
      data: {
        audience: "teacher",
        semesterId: "2026-2",
        source: "CURRENT",
        projection: "overview",
        limit: 25,
        ...(cursor ? { cursor } : {}),
      },
    });
  const largePageOne = await largeRequest();
  const firstPageQueryReads = largeTx.readStats.queryDocuments;
  const largePageTwo = await largeRequest(largePageOne.nextCursor);
  assert.equal(largePageOne.accounts.length, 25);
  assert.equal(largePageTwo.accounts.length, 25);
  assert.ok(largePageOne.nextCursor);
  assert.equal(largePageOne.ledger.length, 0);
  assert.equal(largePageOne.orders.length, 0);
  assert.equal(largePageOne.inventory.length, 0);
  assert.equal(largePageOne.rankings.length, 0);
  assert.equal(
    new Set([
      ...largePageOne.accounts.map((item) => item.accountId),
      ...largePageTwo.accounts.map((item) => item.accountId),
    ]).size,
    50,
  );
  assert.equal(firstPageQueryReads, 26);
  assert.equal(largeTx.readStats.queryDocuments, 52);
  assert.ok(largeTx.readStats.maxQueryDocuments <= 26);
  const beforeHallQueryReads = largeTx.readStats.queryDocuments;
  const largeHallState = await largeQueryCore.getWisEconomyState({
    auth: {
      uid: "large-reader",
      token: { email: "large-reader@yongshin-ms.ms.kr" },
    },
    data: {
      audience: "teacher",
      semesterId: "2026-2",
      source: "CURRENT",
      projection: "hall-of-fame",
      limit: 20,
    },
  });
  assert.equal(largeHallState.hallOfFame.snapshotVersion, 7);
  assert.equal(largeTx.readStats.queryDocuments - beforeHallQueryReads, 206);
  assert.ok(largeTx.readStats.maxQueryDocuments <= 2_001);
  const teacherOrderRequest = (cursor = "", orderStatus = "") =>
    largeQueryCore.getWisEconomyState({
      auth: {
        uid: "large-reader",
        token: { email: "large-reader@yongshin-ms.ms.kr" },
      },
      data: {
        audience: "teacher",
        semesterId: "2026-2",
        source: "CURRENT",
        projection: "orders",
        limit: 2,
        ...(cursor ? { cursor } : {}),
        ...(orderStatus ? { orderStatus } : {}),
      },
    });
  const newestOrderPage = await teacherOrderRequest();
  assert.deepEqual(
    newestOrderPage.orders.map((order) => order.orderId),
    ["order-hash-z", "order-hash-a"],
  );
  const nextOrderPage = await teacherOrderRequest(newestOrderPage.nextCursor);
  assert.deepEqual(
    nextOrderPage.orders.map((order) => order.orderId),
    ["order-hash-y", "order-hash-b"],
  );
  const rejectedOrders = await teacherOrderRequest("", "REJECTED");
  assert.deepEqual(
    rejectedOrders.orders.map((order) => order.orderId),
    ["order-hash-a", "order-hash-b"],
  );
  const studentOrders = await largeQueryCore.getWisEconomyState({
    auth: {
      uid: orderStudentUid,
      token: { email: "order-student@yongshin-ms.ms.kr" },
    },
    data: {
      audience: "student",
      semesterId: "2026-2",
      source: "CURRENT",
      projection: "orders",
      limit: 2,
    },
  });
  assert.deepEqual(
    studentOrders.orders.map((order) => order.orderId),
    ["order-hash-z", "order-hash-a"],
  );
  assert.doesNotMatch(
    JSON.stringify(studentOrders.orders),
    /private-teacher-uid|reviewedBy|studentUid|accountId/u,
  );
  const studentCatalogState = await largeQueryCore.getWisEconomyState({
    auth: {
      uid: orderStudentUid,
      token: { email: "order-student@yongshin-ms.ms.kr" },
    },
    data: {
      audience: "student",
      semesterId: "2026-2",
      source: "CURRENT",
      projection: "catalog",
      limit: 20,
    },
  });
  assert.deepEqual(
    studentCatalogState.products.map((product) => product.productId),
    [activeProductId],
  );
  assert.doesNotMatch(
    JSON.stringify({
      products: studentCatalogState.products,
      inventory: studentCatalogState.inventory,
    }),
    /private-teacher-uid|createdBy|updatedBy/u,
  );
  largeTx.set("semester_enrollments/order-enrollment", {
    ...largeSeed["semester_enrollments/order-enrollment"],
    status: "ACTIVE",
    enrollmentStatus: "WITHDRAWN",
  });
  const withdrawnCatalogState = await largeQueryCore.getWisEconomyState({
    auth: {
      uid: orderStudentUid,
      token: { email: "order-student@yongshin-ms.ms.kr" },
    },
    data: {
      audience: "student",
      semesterId: "2026-2",
      source: "CURRENT",
      projection: "catalog",
    },
  });
  assert.equal(withdrawnCatalogState.status, "EMPTY");
  assert.equal(withdrawnCatalogState.reason, "WIS_ACTIVE_ENROLLMENT_REQUIRED");
  assert.deepEqual(withdrawnCatalogState.products, []);

  const transitionSeed = {
    "semester_manifests/2026-2": manifest,
    "semester_wis_economies/2026-2": {
      semesterId: "2026-2",
      revision: 1,
      status: "PREPARING_INITIALIZING",
      initialGrantAmount: 500,
      integrityVersion: "w10p-aggregate-v1",
      accountCount: 600,
      initializedAccountCount: 600,
      ledgerEntryCount: 2_500,
      inventoryCount: 150,
      orderCount: 700,
      unresolvedLegacyIssueCount: 0,
    },
  };
  for (let index = 0; index < 600; index += 1) {
    transitionSeed[`semester_wis_accounts/transition-${index}`] = {
      accountId: `transition-${index}`,
      semesterId: "2026-2",
      studentUid: `transition-student-${index}`,
      status: "PREPARING",
      revision: 2,
    };
    transitionSeed[`semester_wis_balances/transition-${index}`] = {
      accountId: `transition-${index}`,
      semesterId: "2026-2",
      balance: 500,
    };
    transitionSeed[`semester_wis_rankings/transition-${index}`] = {
      accountId: `transition-${index}`,
      semesterId: "2026-2",
      balance: 500,
    };
  }
  for (let index = 0; index < 2_500; index += 1) {
    transitionSeed[`semester_wis_ledger/transition-ledger-${index}`] = {
      ledgerEntryId: `transition-ledger-${index}`,
      accountId: `transition-${index % 600}`,
      semesterId: "2026-2",
      type: "GRANT",
      delta: 1,
    };
  }
  for (let index = 0; index < 150; index += 1) {
    transitionSeed[`semester_wis_inventory/transition-inventory-${index}`] = {
      inventoryId: `transition-inventory-${index}`,
      semesterId: "2026-2",
    };
  }
  for (let index = 0; index < 700; index += 1) {
    transitionSeed[`semester_wis_orders/transition-order-${index}`] = {
      orderId: `transition-order-${index}`,
      semesterId: "2026-2",
      status: "REQUESTED",
    };
  }
  const transitionTx = new MemoryTransaction(transitionSeed);
  const transitionAdapter = wis.createWisCommandAdapter();
  const transitionResult = await transitionAdapter.apply({
    transaction: transitionTx,
    commandId: "transition-large-1",
    commandType: "transitionWisEconomy",
    payload: wis.normalizeWisPayload("transitionWisEconomy", {
      ...common,
      expectedEconomyRevision: 1,
      targetStatus: "ACTIVE_INITIALIZING",
      reason: "대규모 안전 전환",
    }),
    receiptId: "transition-large-receipt-1",
    timestamp: "transition-large-time-1",
    actor,
  });
  assert.equal(transitionResult.result.status, "ACTIVE_INITIALIZING");
  const openedLarge = await transitionAdapter.apply({
    transaction: transitionTx,
    commandId: "transition-large-2",
    commandType: "transitionWisEconomy",
    payload: wis.normalizeWisPayload("transitionWisEconomy", {
      ...common,
      expectedEconomyRevision: 2,
      targetStatus: "ACTIVE_OPEN",
      reason: "대규모 운영 시작",
    }),
    receiptId: "transition-large-receipt-2",
    timestamp: "transition-large-time-2",
    actor,
  });
  assert.equal(openedLarge.result.status, "ACTIVE_OPEN");
  assert.equal(transitionTx.readStats.queryCalls, 0);
  assert.equal(
    (await transitionTx.get("semester_wis_accounts/transition-599")).data
      .status,
    "PREPARING",
  );
  const readinessQueryCallsBefore = transitionTx.readStats.queryCalls;
  const readinessQueryDocumentsBefore = transitionTx.readStats.queryDocuments;
  const [largeReadiness] = await wis
    .createWisReadinessAdapter()
    .evaluate({ transaction: transitionTx, manifest });
  assert.equal(largeReadiness.status, "PASS");
  assert.equal(
    transitionTx.readStats.queryCalls - readinessQueryCallsBefore,
    7,
  );
  assert.equal(
    transitionTx.readStats.queryDocuments - readinessQueryDocumentsBefore,
    6,
  );
  assert.ok(transitionTx.readStats.maxQueryDocuments <= 26);

  const readiness = wis.createWisReadinessAdapter();
  const [check] = await readiness.evaluate({ transaction: tx, manifest });
  assert.equal(check.status, "PASS");
  assert.match(check.evidence, /accounts=1/);

  tx.set(`semester_enrollments/${enrollment.enrollmentId}`, {
    ...enrollment,
    status: "ACTIVE",
    enrollmentStatus: "WITHDRAWN",
  });
  await assert.rejects(
    () =>
      apply("createWisAccounts", {
        ...common,
        expectedEconomyRevision: 3,
        enrollmentIds: [enrollment.enrollmentId],
        reason: "상충 재적 상태 차단",
      }),
    (error) => error.details?.reason === "WIS_ENROLLMENT_INVALID",
  );
  const movedEnrollmentId = "enrollment-moved";
  tx.set("semester_classes/class-moved", {
    classId: "class-moved",
    semesterId: "2026-2",
    grade: "2",
    classNumber: "4",
    status: "ACTIVE",
  });
  tx.set(`semester_enrollments/${enrollment.enrollmentId}`, {
    ...enrollment,
    enrollmentStatus: "TRANSFERRED",
  });
  tx.set(`semester_enrollments/${movedEnrollmentId}`, {
    ...enrollment,
    enrollmentId: movedEnrollmentId,
    classId: "class-moved",
    displayName: "이동 학생",
    enrollmentStatus: "ACTIVE",
  });
  tx.set(`semester_enrollment_slots/${enrollmentSlotId}`, {
    semesterId: "2026-2",
    studentUid: "student-1",
    activeEnrollmentId: movedEnrollmentId,
  });
  const syncedAccount = await apply("createWisAccounts", {
    ...common,
    expectedEconomyRevision: 3,
    enrollmentIds: [movedEnrollmentId],
    reason: "학급 이동 메타데이터 동기화",
  });
  assert.deepEqual(
    {
      createdCount: syncedAccount.result.createdCount,
      syncedCount: syncedAccount.result.syncedCount,
      enrollmentId: (await tx.get(`semester_wis_accounts/${accountId}`)).data
        .enrollmentId,
      classId: (await tx.get(`semester_wis_accounts/${accountId}`)).data
        .classId,
      rankingClassId: (await tx.get(`semester_wis_rankings/${accountId}`)).data
        .classId,
    },
    {
      createdCount: 0,
      syncedCount: 1,
      enrollmentId: movedEnrollmentId,
      classId: "class-moved",
      rankingClassId: "class-moved",
    },
  );

  tx.set("semester_manifests/2026-2", { ...manifest, status: "ARCHIVED" });
  await assert.rejects(
    () =>
      apply("grantWis", {
        ...common,
        expectedEconomyRevision: 3,
        accountId,
        expectedAccountRevision: 7,
        amount: 1,
        sourceId: "archive",
        reason: "금지",
      }),
    (error) => error.details?.reason === "SEMESTER_ARCHIVED_WRITE_FORBIDDEN",
  );

  console.log(JSON.stringify({ passed: true, cases: 38, productionAccess: 0 }));
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
