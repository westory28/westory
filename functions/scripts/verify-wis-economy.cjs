const assert = require("node:assert/strict");
const wis = require("../wisEconomy");

class MemoryTransaction {
  constructor(seed = {}) {
    this.documents = new Map(Object.entries(seed).map(([path, data]) => [path, structuredClone(data)]));
  }
  async get(path) {
    return { exists: this.documents.has(path), data: this.documents.has(path) ? structuredClone(this.documents.get(path)) : null, path };
  }
  async getAll(paths) { const output = []; for (const path of paths) output.push(await this.get(path)); return output; }
  async query(collection, filter = null) {
    const prefix = `${collection}/`;
    return [...this.documents.entries()].filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, data]) => ({ exists: true, path, data: structuredClone(data) }))
      .filter((row) => !filter || row.data?.[filter.field] === filter.value);
  }
  set(path, data, options) {
    const current = this.documents.get(path) || {};
    this.documents.set(path, structuredClone(options?.merge ? { ...current, ...data } : data));
  }
  create(path, data) {
    if (this.documents.has(path)) throw new Error(`already exists: ${path}`);
    this.documents.set(path, structuredClone(data));
  }
  delete(path) { this.documents.delete(path); }
}

const actor = { actorUid: "teacher-1", actorRole: "teacher", actorEmail: "teacher@yongshin-ms.ms.kr" };
const student = { actorUid: "student-1", actorRole: "student", actorEmail: "student@yongshin-ms.ms.kr" };
const manifest = { semesterId: "2026-2", revision: 7, status: "ACTIVE" };
const enrollment = { enrollmentId: "enrollment-1", semesterId: "2026-2", studentUid: "student-1", classId: "class-1", displayName: "합성 학생", status: "ACTIVE" };
const tx = new MemoryTransaction({
  "semester_manifests/2026-2": manifest,
  "semester_enrollments/enrollment-1": enrollment,
});
const adapter = wis.createWisCommandAdapter();
let commandIndex = 0;
const apply = async (commandType, payload, targetActor = actor) => adapter.apply({ transaction: tx, commandId: `command-${++commandIndex}`, commandType, payload: wis.normalizeWisPayload(commandType, payload), receiptId: `receipt-${commandIndex}`, timestamp: `timestamp-${commandIndex}`, actor: targetActor });
const common = { semesterId: "2026-2", expectedSemesterRevision: 7 };

const run = async () => {
  const created = await apply("createSemesterEconomy", { ...common, displayName: "2026학년도 2학기 위스", currencyName: "위스", initialGrantAmount: 500 });
  assert.equal(created.result.status, "ACTIVE_INITIALIZING");

  const accounts = await apply("createWisAccounts", { ...common, expectedEconomyRevision: 1, enrollmentIds: ["enrollment-1"], reason: "계정 생성" });
  assert.equal(accounts.result.createdCount, 1);
  const accountId = wis.accountIdFor("2026-2", "student-1");
  assert.equal((await tx.get(`semester_wis_accounts/${accountId}`)).data.balance, 0);

  await assert.rejects(() => apply("grantInitialWis", { ...common, expectedEconomyRevision: 2, accountId, expectedAccountRevision: 1, amount: 100, sourceId: "invalid-initial", reason: "정책과 다른 최초 지급" }), (error) => error.details?.reason === "WIS_INITIAL_GRANT_AMOUNT_MISMATCH");
  assert.equal((await tx.get(`semester_wis_accounts/${accountId}`)).data.balance, 0);
  assert.equal((await tx.query("semester_wis_ledger", { field: "accountId", value: accountId })).length, 0);

  const initial = await apply("grantInitialWis", { ...common, expectedEconomyRevision: 2, accountId, expectedAccountRevision: 1, amount: 500, sourceId: "initial-2026-2", reason: "최초 지급" });
  assert.equal(initial.result.balance, 500);
  await assert.rejects(() => apply("grantInitialWis", { ...common, expectedEconomyRevision: 2, accountId, expectedAccountRevision: 2, amount: 500, sourceId: "other-initial", reason: "중복" }), (error) => error.details?.reason === "WIS_INITIAL_GRANT_ALREADY_APPLIED");

  const opened = await apply("transitionWisEconomy", { ...common, expectedEconomyRevision: 2, targetStatus: "ACTIVE_OPEN", reason: "운영 시작" });
  assert.equal(opened.result.status, "ACTIVE_OPEN");

  const grant = await apply("grantWis", { ...common, expectedEconomyRevision: 3, accountId, expectedAccountRevision: 2, amount: 100, sourceId: "lesson-1", reason: "수업 참여" });
  assert.equal(grant.result.balance, 600);
  await assert.rejects(() => apply("grantWis", { ...common, expectedEconomyRevision: 3, accountId, expectedAccountRevision: 3, amount: 100, sourceId: "lesson-1", reason: "중복" }), (error) => error.details?.reason === "WIS_LEDGER_SOURCE_EXISTS");
  await assert.rejects(() => apply("deductWis", { ...common, expectedEconomyRevision: 3, accountId, expectedAccountRevision: 3, amount: 1000, sourceId: "too-much", reason: "초과 회수" }), (error) => error.details?.reason === "WIS_INSUFFICIENT_BALANCE");

  const originalLedgerBeforeReversal = (await tx.get(`semester_wis_ledger/${grant.result.ledgerEntryId}`)).data;
  const reverse = await apply("reverseWisEntry", { ...common, expectedEconomyRevision: 3, accountId, expectedAccountRevision: 3, ledgerEntryId: grant.result.ledgerEntryId, reason: "오지급 취소" });
  assert.equal(reverse.result.balance, 500);
  assert.deepEqual((await tx.get(`semester_wis_ledger/${grant.result.ledgerEntryId}`)).data, originalLedgerBeforeReversal);
  await assert.rejects(() => apply("reverseWisEntry", { ...common, expectedEconomyRevision: 3, accountId, expectedAccountRevision: 4, ledgerEntryId: grant.result.ledgerEntryId, reason: "중복 취소" }), (error) => error.details?.reason === "WIS_LEDGER_SOURCE_EXISTS");

  const product = await apply("upsertWisProduct", { ...common, expectedEconomyRevision: 3, expectedProductRevision: null, name: "연필", description: "학습용 연필", imageUrl: "", active: true, reason: "상품 등록" });
  const inventory = await apply("upsertWisInventory", { ...common, expectedEconomyRevision: 3, productId: product.result.productId, expectedInventoryRevision: null, price: 100, stock: 2, active: true, reason: "재고 등록" });
  const order = await apply("placeWisOrder", { ...common, expectedEconomyRevision: 3, inventoryId: inventory.result.inventoryId, expectedInventoryRevision: 1, expectedAccountRevision: 4, quantity: 1 }, student);
  assert.equal(order.result.balance, 400);
  assert.equal((await tx.get(`semester_wis_inventory/${inventory.result.inventoryId}`)).data.available, 1);
  await assert.rejects(() => apply("placeWisOrder", { ...common, expectedEconomyRevision: 3, inventoryId: inventory.result.inventoryId, expectedInventoryRevision: 2, expectedAccountRevision: 5, quantity: 5 }, student), (error) => error.details?.reason === "WIS_INSUFFICIENT_STOCK");

  const rejected = await apply("reviewWisOrder", { ...common, expectedEconomyRevision: 3, orderId: order.result.orderId, expectedOrderRevision: 1, action: "REJECT", reason: "합성 반려" });
  assert.equal(rejected.result.balance, 500);
  assert.equal((await tx.get(`semester_wis_inventory/${inventory.result.inventoryId}`)).data.available, 2);

  const rebuild = await apply("rebuildWisProjection", { ...common, expectedEconomyRevision: 3, accountId, reason: "projection 대조" });
  assert.equal(rebuild.result.balance, 500);
  assert.equal(rebuild.result.status, "PASS");

  const store = {
    get: (path) => tx.get(path),
    runTransaction: (callback) => callback(tx),
  };
  const queryCore = wis.createWisQueryCore({ store, assertSession: async (request) => ({ uid: request.auth.uid, email: request.auth.token.email }) });
  tx.set("users/student-1", { role: "student" });
  const studentState = await queryCore.getWisEconomyState({ auth: { uid: "student-1", token: { email: "student@yongshin-ms.ms.kr" } }, data: { audience: "student", semesterId: "2026-2", source: "CURRENT" } });
  assert.equal(studentState.account.accountId, accountId);
  assert.equal(studentState.writeCount, 0);
  assert.equal(studentState.rankings[0].rank, 1);

  const readiness = wis.createWisReadinessAdapter();
  const [check] = await readiness.evaluate({ transaction: tx, manifest });
  assert.equal(check.status, "PASS");
  assert.match(check.evidence, /accounts=1/);

  tx.set("semester_manifests/2026-2", { ...manifest, status: "ARCHIVED" });
  await assert.rejects(() => apply("grantWis", { ...common, expectedEconomyRevision: 3, accountId, expectedAccountRevision: 7, amount: 1, sourceId: "archive", reason: "금지" }), (error) => error.details?.reason === "SEMESTER_ARCHIVED_WRITE_FORBIDDEN");

  console.log(JSON.stringify({ passed: true, cases: 23, productionAccess: 0 }));
};

run().catch((error) => { console.error(error); process.exitCode = 1; });
