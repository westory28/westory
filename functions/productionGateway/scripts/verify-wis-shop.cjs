const assert = require("node:assert/strict");
const gateway = require("../commandGateway");
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


// Keep writes private until the callback succeeds, like the Firestore transaction.
class MemoryStore {
  constructor(seed) { this.tx = new MemoryTransaction(seed); this.queue = Promise.resolve(); }
  get(path) { return this.tx.get(path); }
  runTransaction(callback) {
    const task = this.queue.then(async () => {
      const pending = new MemoryTransaction(Object.fromEntries(this.tx.documents));
      const result = await callback(pending);
      this.tx = pending;
      return result;
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
const teacher = { actorUid: "teacher", actorRole: "teacher" };
const student = { actorUid: "student", actorRole: "student" };
const common = { semesterId: "2026-2", expectedSemesterRevision: 7, expectedEconomyRevision: 1 };
const reason = (expected) => (error) => error.details?.reason === expected;
const seedFor = (wis) => {
  const accountId = wis.accountIdFor("2026-2", student.actorUid);
  const inventoryId = wis.inventoryIdFor("2026-2", "pencil");
  return {
    "site_settings/semester_active": { semesterId: "2026-2", revision: 7 },
    "semester_manifests/2026-2": { semesterId: "2026-2", status: "ACTIVE", revision: 7 },
    "semester_wis_economies/2026-2": { semesterId: "2026-2", status: "ACTIVE_OPEN", revision: 1,
      accountCount: 1, inventoryCount: 1, orderCount: 0, ledgerEntryCount: 0 },
    ["semester_wis_accounts/" + accountId]: { accountId, semesterId: "2026-2", studentUid: "student",
      enrollmentId: "enrollment", classId: "class", balance: 1000, revision: 1, earnedTotal: 1000, spentTotal: 0 },
    ["semester_enrollment_slots/" + archiveEnrollment.buildEnrollmentSlotId("2026-2", "student")]: {
      semesterId: "2026-2", studentUid: "student", activeEnrollmentId: "enrollment" },
    "semester_enrollments/enrollment": { enrollmentId: "enrollment", semesterId: "2026-2", studentUid: "student",
      classId: "class", enrollmentStatus: "ACTIVE", studentNumber: "7",
      snapshot: { displayName: "주문 당시 이름", grade: "2", classNumber: "3", studentNumber: "7" } },
    "wis_product_catalog/pencil": { productId: "pencil", revision: 1, name: "연필", active: true,
      imageUrl: "https://example.test/pencil.webp", previewImageUrl: "https://example.test/preview.webp" },
    ["semester_wis_inventory/" + inventoryId]: { inventoryId, semesterId: "2026-2", productId: "pencil",
      productName: "연필", productRevision: 1, revision: 1, active: true, price: 100,
      stock: 5, available: 5, reserved: 0, sold: 0 },
  };
};
const runCommands = async (moduleName) => {
  const wis = require("../" + moduleName);
  const store = new MemoryStore(seedFor(wis));
  const adapter = wis.createWisCommandAdapter();
  const accountId = wis.accountIdFor("2026-2", "student");
  const inventoryId = wis.inventoryIdFor("2026-2", "pencil");
  let sequence = 0;
  const apply = async (commandType, payload, actor = teacher) => {
    const index = ++sequence;
    return store.runTransaction((transaction) => adapter.apply({ transaction, commandType,
      payload: wis.normalizeWisPayload(commandType, { ...common, ...payload }),
      actor, commandId: "command-" + index, receiptId: "receipt-" + index, timestamp: "time-" + index }));
  };
  const data = async (collection, id) => (await store.get(collection + "/" + id)).data;
  const inventory = () => data("semester_wis_inventory", inventoryId);
  const account = () => data("semester_wis_accounts", accountId);
  const order = (id) => data("semester_wis_orders", id);
  const invariant = async () => {
    const i = await inventory();
    assert.equal(i.stock, i.available + i.reserved + i.sold);
    assert.ok([i.available, i.reserved, i.sold].every((value) => value >= 0));
  };
  const place = async (quantity = 1) => apply("placeWisOrder", { inventoryId,
    expectedInventoryRevision: (await inventory()).revision, expectedAccountRevision: (await account()).revision,
    quantity, memo: "파란색 부탁드립니다." }, student);
  const review = async (id, action) => apply("reviewWisOrder", { orderId: id, action,
    expectedOrderRevision: (await order(id)).revision, reason: "교사 처리" });
  const cancel = async (id, actor = student) => apply("cancelWisOrder", { orderId: id,
    expectedOrderRevision: (await order(id)).revision, reason: "구매 취소" }, actor);
  const noChange = async (callback, expected) => {
    const before = JSON.stringify([...store.tx.documents]);
    await assert.rejects(callback, reason(expected));
    assert.equal(JSON.stringify([...store.tx.documents]), before);
  };
  const productInput = { ...common, productId: "pencil", expectedProductRevision: 1,
    name: "연필", description: "파랑/검정\n선택 가능", imageUrl: "https://firebasestorage.googleapis.com/v0/b/demo/o/a%2Fb?token=test",
    previewImageUrl: "https://example.test/preview.webp", active: true, reason: "상품 수정" };
  assert.equal(wis.normalizeWisPayload("upsertWisProduct", productInput).imageUrl, productInput.imageUrl);
  for (const url of ["http://example.test/a", "javascript:alert(1)", "data:image/png,a", "https://user:password@example.test/a"])
    assert.throws(() => wis.normalizeWisPayload("upsertWisProduct", { ...productInput, imageUrl: url }), reason("WIS_PAYLOAD_INVALID"));
  const { previewImageUrl, ...previousPayload } = productInput;
  assert.equal(Object.hasOwn(wis.normalizeWisPayload("upsertWisProduct", previousPayload), "previewImageUrl"), false,
    "omitted optional image fields preserve previous command receipt hashes");

  const normalized = wis.normalizeWisPayload("upsertWisProduct", { ...productInput, sortOrder: 20 });
  assert.equal(normalized.sortOrder, 20);
  for (const sortOrder of [-1, 1.5, "20", 1000001])
    assert.throws(() => wis.normalizeWisPayload("upsertWisProduct", { ...productInput, sortOrder }), reason("WIS_PAYLOAD_INVALID"));
  assert.equal(Object.hasOwn(wis.normalizeWisPayload("upsertWisProduct", productInput), "sortOrder"), false);
  await apply("upsertWisProduct", { ...productInput, sortOrder: 20 });
  assert.equal((await data("wis_product_catalog", "pencil")).sortOrder, 20);
  assert.equal((await inventory()).productSortOrder, 20);
  await apply("upsertWisProduct", { ...productInput, expectedProductRevision: 2 });
  assert.equal((await data("wis_product_catalog", "pencil")).sortOrder, 20, "old clients omitting sortOrder must retain the existing value");
  assert.equal((await inventory()).productSortOrder, 20);
  const placed = await place(2);
  const id = placed.result.orderId;
  assert.equal((await account()).balance, 800);
  assert.equal((await inventory()).reserved, 2);
  assert.equal((await order(id)).productPreviewImageUrl, "https://example.test/preview.webp");
  assert.equal((await order(id)).studentName, "주문 당시 이름");
  assert.equal((await order(id)).grade, "2");
  assert.equal((await order(id)).class, "3");
  assert.equal((await order(id)).number, "7");
  await noChange(() => cancel(id, { actorUid: "other-student", actorRole: "student" }), "WIS_ORDER_NOT_FOUND");
  await review(id, "APPROVE");
  const approvedAt = (await order(id)).approvedAt;
  await review(id, "READY");
  assert.equal((await order(id)).approvedAt, approvedAt);
  assert.ok((await order(id)).readyAt);
  await noChange(() => cancel(id), "WIS_ORDER_STATE_INVALID");
  await review(id, "CANCEL");
  assert.equal((await account()).balance, 1000);
  assert.equal((await order(id)).status, "CANCELLED");
  assert.ok((await order(id)).refundLedgerEntryId);
  assert.equal((await order(id)).memo, "파란색 부탁드립니다.");
  await invariant();
  await noChange(() => review(id, "CANCEL"), "WIS_ORDER_STATE_INVALID");

  const fulfilled = (await place(2)).result.orderId;
  await review(fulfilled, "APPROVE");
  await review(fulfilled, "FULFILL"); // old clients may skip READY
  assert.equal((await inventory()).sold, 2);
  assert.equal((await inventory()).available, 3);
  assert.ok((await order(fulfilled)).fulfilledAt);
  await noChange(() => review(fulfilled, "CANCEL"), "WIS_ORDER_STATE_INVALID");
  const editInventory = async (stock) => apply("upsertWisInventory", { productId: "pencil",
    expectedInventoryRevision: (await inventory()).revision, price: 100, stock, active: true, reason: "입고 수량 조정" });
  const edited = await editInventory(6);
  assert.equal(edited.result.sold, 2);
  assert.equal(edited.result.reserved, 0);
  assert.equal((await inventory()).available, 4, "handed-over items must not reappear after editing inventory");
  await noChange(() => editInventory(1), "WIS_INVENTORY_RESERVED_CONFLICT");
  await noChange(() => place(5), "WIS_INSUFFICIENT_STOCK");
  await invariant();

  const requested = (await place()).result.orderId;
  await cancel(requested);
  assert.equal((await order(requested)).status, "CANCELLED");
  assert.equal((await account()).balance, 800);
  await invariant();
  const rejected = (await place()).result.orderId;
  await review(rejected, "REJECT");
  assert.equal((await order(rejected)).status, "REJECTED");
  assert.equal((await account()).balance, 800);

  const corrupt = (await place()).result.orderId;
  const i = await inventory();
  store.tx.set("semester_wis_inventory/" + inventoryId, { semesterId: "2026-1" }, { merge: true });
  await noChange(() => cancel(corrupt), "WIS_ORDER_DEPENDENCY_INVALID");
  store.tx.set("semester_wis_inventory/" + inventoryId, i);
  const debitId = (await order(corrupt)).debitLedgerEntryId;
  const debit = await data("semester_wis_ledger", debitId);
  store.tx.set("semester_wis_ledger/" + debitId, { delta: -1 }, { merge: true });
  await noChange(() => cancel(corrupt), "WIS_ORDER_DEPENDENCY_INVALID");
  store.tx.set("semester_wis_ledger/" + debitId, debit);
  await cancel(corrupt);
  store.tx.set("site_settings/semester_active", { semesterId: "2027-1" });
  await noChange(() => editInventory(10), "SEMESTER_ARCHIVED_WRITE_FORBIDDEN");
  await noChange(() => place(), "SEMESTER_ARCHIVED_WRITE_FORBIDDEN");
  store.tx.set("site_settings/semester_active", { semesterId: "2026-2" });

  // A response lost after commit replays the same receipt and cannot refund twice.
  const replayId = (await place()).result.orderId;
  const core = gateway.createCommandGatewayCore({ store, assertSession: async () => ({ uid: "student" }),
    authorizeCommand: async () => student, commandAdapters: { cancelWisOrder: adapter },
    serverTimestamp: () => "2026-10-18T00:00:00Z", concreteTimestamp: () => "2026-10-18T00:00:00Z",
    projectId: "demo-westory-session-wis-shop" });
  const request = { auth: { uid: "student" }, data: {
    commandId: "e0000000-0000-4000-8000-000000000001", commandType: "cancelWisOrder",
    payload: { ...common, orderId: replayId, expectedOrderRevision: 1, reason: "구매 취소" },
    _testDropResponseAfterCommit: true } };
  await assert.rejects(() => core.execute(request), (error) => error.code === "unavailable");
  const snapshot = JSON.stringify([...store.tx.documents]);
  const replay = await core.execute(request);
  assert.equal(replay.replayed, true);
  assert.equal(JSON.stringify([...store.tx.documents]), snapshot);
  assert.equal((await account()).balance, 800);
  assert.equal(wis.STUDENT_COMMAND_TYPES.has("cancelWisOrder"), true);
  assert.deepEqual(wis.getWisCommandSessionOptions("cancelWisOrder"), { recentAuth: false, highRisk: false });

  // Two buyers acting on the same last unit cannot both reserve it.
  await editInventory(3); // two handed over, one available
  const lastRevision = (await inventory()).revision;
  const lastAccountRevision = (await account()).revision;
  const simultaneous = await Promise.allSettled([1, 2].map(() => apply("placeWisOrder", {
    inventoryId, expectedInventoryRevision: lastRevision, expectedAccountRevision: lastAccountRevision, quantity: 1,
  }, student)));
  assert.equal(simultaneous.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(simultaneous.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await inventory()).available, 0);
  await invariant();
  console.log("PASS " + moduleName + ": transitions, ownership, lifecycle timestamps, no duplicate refund, stock accounting, stale concurrent revisions, image URL contract");
};

const runArchives = async () => {
  const wis = require("../wisEconomyQuery");
  const tx = new MemoryTransaction({
    "users/teacher": { role: "teacher", staffPermissions: ["point_manage"] },
    "users/reader": { role: "teacher", staffPermissions: ["point_read"] },
    "users/student": { role: "student" },
    "users/assistant": { role: "student", teacherPortalEnabled: true, staffPermissions: ["point_read"] },
    "site_settings/semester_active": { semesterId: "2026-2" },
    "semester_manifests/2026-1": { status: "ACTIVE", revision: 2 },
    "semester_wis_economies/2026-1": { status: "ACTIVE_OPEN", revision: 1 },
    "years/2026/semesters/1/point_products/a": { name: "배지", price: 200, stock: 0, isActive: false,
      imageUrl: "https://example.test/badge.webp", previewImageUrl: "https://example.test/badge-preview.webp" },
    "years/2026/semesters/1/point_products/b": { name: "배너 광고", price: 300, stock: 4, isActive: true },
    "years/2026/semesters/1/point_orders/o": { uid: "old", studentName: "과거 학생", productId: "a",
      productName: "배지", status: "fulfilled", priceSnapshot: 200, requestedAt: "2026-06-01", reviewedAt: "2026-06-02" },
    "years/2026/semesters/2/point_products/secret": { name: "다른 학기 상품", stock: 1 },
  });
  const core = wis.createWisQueryCore({ store: { get: tx.get.bind(tx), runTransaction: (callback) => callback(tx) },
    assertSession: async (request) => ({ uid: request.auth.uid }) });
  const read = (extra = {}, uid = "teacher") => core.getWisEconomyState({ auth: { uid },
    data: { audience: "teacher", semesterId: "2026-1", source: "EXPLICIT", projection: "catalog", limit: 1, ...extra } });
  const initial = JSON.stringify([...tx.documents]);
  const first = await read();
  assert.equal(first.readOnly, true);
  assert.equal(first.provenance, "LEGACY");
  assert.equal(first.products[0].name, "배지");
  assert.equal(first.products[0].previewImageUrl, "https://example.test/badge-preview.webp");
  assert.equal(first.products[0].active, false, "retired and sold-out products are historical examples too");
  const next = await read({ cursor: first.nextCursor });
  assert.equal(next.products[0].name, "배너 광고");
  assert.equal(next.inventory[0].available, 4);
  assert.equal(next.nextCursor, "");
  const oldOrders = await read({ projection: "orders" });
  assert.equal(oldOrders.orders[0].status, "FULFILLED");
  assert.equal(oldOrders.accounts[0].displayName, "과거 학생");
  assert.equal(oldOrders.orders[0].createdAt, "2026-06-01");
  assert.equal(oldOrders.orders[0].totalPrice, 200);
  assert.equal((await read({}, "reader")).products.length, 1);
  await assert.rejects(() => read({}, "student"), reason("WIS_MANAGE_REQUIRED"));
  assert.deepEqual((await read({ source: "LEGACY" }, "assistant")).products, [], "student helpers cannot enter the historical teacher adapter");
  assert.equal((await read({ source: "CURRENT" })).readOnly, true, "stale ACTIVE manifests cannot make historical scope writable");
  assert.equal((await read({ source: "CURRENT" })).products[0].name, "배지");
  assert.equal(JSON.stringify([...tx.documents]), initial, "archive reads never migrate or mutate records");
  tx.documents.delete("semester_wis_economies/2026-1");
  tx.documents.delete("semester_manifests/2026-1");
  assert.equal((await read()).products[0].name, "배지", "legacy catalog does not require a fabricated canonical economy");
  tx.set("semester_manifests/2026-1", { status: "ARCHIVED", revision: 2 });
  tx.set("semester_wis_economies/2026-1", { status: "CLOSED", revision: 1 });
  const inv = wis.inventoryIdFor("2026-1", "deleted");
  tx.set("semester_wis_inventory/" + inv, { inventoryId: inv, semesterId: "2026-1", productId: "deleted",
    productName: "학기 당시 상품", productImageUrl: "https://example.test/historical.webp",
    productDescription: "보관 설명", productSortOrder: 30, stock: 2, available: 0, reserved: 0, sold: 2, active: true });
  const archived = await read();
  assert.equal(archived.products[0].name, "학기 당시 상품");
  assert.equal(archived.products[0].imageUrl, "https://example.test/historical.webp");
  assert.equal(archived.products[0].sortOrder, 30);
  assert.equal(archived.products.length, 1, "canonical inventory wins and does not duplicate legacy records");
  tx.set("wis_product_catalog/deleted", { productId: "deleted", name: "지금 이름", imageUrl: "https://example.test/new.webp" });
  assert.equal((await read()).products[0].name, "학기 당시 상품");
  console.log("PASS archives: selected-semester legacy products/orders, retired images, bounded pages, historical snapshots, permissions, zero writes");
};
(async () => { await runCommands("wisEconomy"); await runCommands("wisEconomyQuery"); await runArchives(); })()
  .catch((error) => { console.error(error); process.exitCode = 1; });
