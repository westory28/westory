/** Client contracts against synthetic transports; never initializes Firebase. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = (file, dependencies) => {
  const exports = {};
  const source = ts.transpileModule(
    readFileSync(path.join(root, file), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(
    source,
    {
      exports,
      Date,
      URLSearchParams,
      require(name) {
        if (Object.hasOwn(dependencies, name)) return dependencies[name];
        throw new Error(`Unexpected dependency: ${name}`);
      },
    },
    { filename: file },
  );
  return exports;
};
class FakeTimestamp {
  constructor(seconds, nanoseconds = 0) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  static fromMillis(ms) {
    return new FakeTimestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }
}
const auth = {
  currentUser: {
    uid: "synthetic-owner",
    getIdTokenResult: async () => ({ claims: { auth_time: 1234 } }),
  },
};
let response;
const requests = [];
const storage = {
  readStorage: () => null,
  writeStorage: () => {},
  removeStorage: () => {},
};
const makeClient = (archive) =>
  load("src/lib/wisEconomyClient.ts", {
    "firebase/firestore": { Timestamp: FakeTimestamp },
    "./firebase": { auth },
    "./historyDictionarySession": {
      getHistoryDictionaryCallable: async (name) => async (payload) => {
        requests.push({ name, payload });
        return { data: response };
      },
    },
    "./semesterScope": { getYearSemester: (config) => config },
    "./semesterArchive": { isSemesterArchive: archive },
    "./sensitiveOperation": { ensureSensitiveOperation: async () => {} },
    "./safeStorage": storage,
  });
const state = () => ({
  semesterId: "2025-2",
  manifestRevision: 3,
  readOnly: false,
  economy: { revision: 4 },
  account: {
    accountId: "account-a",
    studentUid: "synthetic-owner",
    revision: 5,
    balance: 900,
  },
  accounts: [],
  ledger: [],
  orders: [],
  nextCursor: "",
  products: [
    {
      productId: "book",
      name: "노트",
      active: true,
      imageUrl: "detail.webp",
      previewImageUrl: "thumb.webp",
    },
    { productId: "hidden", name: "비공개", active: false },
    { productId: "unstocked", name: "재고 미등록", active: true },
  ],
  inventory: [
    {
      productId: "book",
      inventoryId: "inventory-a",
      active: true,
      revision: 6,
      price: 120,
      stock: 10,
      available: 4,
      reserved: 2,
      sold: 4,
    },
    {
      productId: "hidden",
      inventoryId: "inventory-hidden",
      active: true,
      price: 200,
      stock: 5,
      available: 5,
      reserved: 0,
      sold: 0,
    },
  ],
});
let checks = 0;
const check = async (name, run) => {
  await run();
  checks++;
  console.log(`PASS ${name}`);
};
const client = makeClient(false);
await check(
  "학생 판매목록은 비공개·미등록 재고를 제외하고 가용 수량을 보존",
  () => {
    const products = client.wisProducts(state(), true);
    assert.equal(products.length, 1);
    assert.equal(products[0].stock, 4);
    assert.equal(products[0].availableStock, 4);
    assert.equal(products[0].imageUrl, "detail.webp");
    assert.equal(products[0].previewImageUrl, "thumb.webp");
  },
);
await check("교사 목록은 입고·예약·지급 수량과 비공개 상품을 보존", () => {
  const products = client.wisProducts(state(), false);
  assert.equal(products.length, 2);
  assert.equal(products[0].stock, 10);
  assert.equal(products[0].reservedStock, 2);
  assert.equal(products[0].soldStock, 4);
  assert.equal(products[1].isActive, false);
});
await check("이전 학기 상품 읽기 전용 전파 및 쓰기 revision 차단", () => {
  const archived = { ...state(), readOnly: true };
  assert.equal(client.wisProducts(archived, false)[0].readOnly, true);
  assert.throws(() => client.wisRevisionScope(archived), /현재 학기/);
});
await check("주문 수량·단가·검토 메모·준비 시각과 구형 주문 기본값", () => {
  const order = client.wisOrder({
    orderId: "order-a",
    status: "READY",
    quantity: 2,
    unitPrice: 120,
    totalPrice: 240,
    memo: "학생 메모",
    reviewReason: "교사 메모",
    readyAt: "2026-10-18T03:00:00Z",
  });
  assert.equal(order.status, "ready");
  assert.equal(order.quantity, 2);
  assert.equal(order.unitPrice, 120);
  assert.equal(order.priceSnapshot, 240);
  assert.equal(order.memo, "학생 메모");
  assert.equal(order.reviewReason, "교사 메모");
  assert.equal(order.readyAt.seconds, 1792292400);
  const legacy = client.wisOrder({
    orderId: "old-order",
    status: "FULFILLED",
    totalPrice: 80,
  });
  assert.equal(legacy.quantity, 1);
  assert.equal(legacy.unitPrice, 80);
  assert.equal(legacy.readyAt, null);
});
await check(
  "이전 학기 교사 조회는 선택 학기의 EXPLICIT 범위를 사용",
  async () => {
    response = state();
    const archiveClient = makeClient(true);
    await archiveClient.queryWisState(
      { year: "2025", semester: "2" },
      "teacher",
      "catalog",
    );
    assert.equal(requests.at(-1).payload.source, "EXPLICIT");
    assert.equal(requests.at(-1).payload.semesterId, "2025-2");
  },
);
await check(
  "학생 조회는 CURRENT 범위를 유지하고 다른 학기 응답을 거절",
  async () => {
    response = state();
    await client.queryWisState(
      { year: "2025", semester: "2" },
      "student",
      "catalog",
    );
    assert.equal(requests.at(-1).payload.source, "CURRENT");
    response = { ...state(), semesterId: "2026-1" };
    await assert.rejects(
      client.queryWisState(
        { year: "2025", semester: "2" },
        "teacher",
        "catalog",
      ),
      /학기가 바뀌/,
    );
  },
);

let adapterState = state();
const commands = [];
const adapter = load("src/lib/pointEconomyAdapter.ts", {
  "./firebase": { auth },
  "./safeStorage": storage,
  "./wisRankingPreview": {
    getWisHallOfFameState: () => {
      throw new Error("Unexpected ranking request in shop checks");
    },
  },
  "./wisEconomyClient": {
    ...client,
    queryWisState: async () => adapterState,
    runWisOperation: async (_intent, _sensitive, run) =>
      run(async (_step, prepare) => {
        commands.push(await prepare());
        return {
          orderId: "new-order",
          ledgerEntryId: "ledger-a",
          balance: 660,
        };
      }),
  },
});
const purchase = {
  config: { year: "2025", semester: "2" },
  productId: "book",
  expectedPrice: 120,
  requestKey: "synthetic-key",
  quantity: 2,
  memo: "  파란색  ",
};
await check(
  "복수 구매는 수량·가격 확인 후 학기/재고/계좌 revision을 전달",
  async () => {
    await adapter.createCanonicalPurchase(purchase);
    const command = commands.at(-1);
    assert.equal(command.commandType, "placeWisOrder");
    assert.equal(command.payload.quantity, 2);
    assert.equal(command.payload.memo, "파란색");
    assert.equal(command.payload.expectedInventoryRevision, 6);
    assert.equal(command.payload.expectedAccountRevision, 5);
    assert.equal(command.payload.semesterId, "2025-2");
  },
);
await check("잘못된 수량·부족한 가용재고·가격변경은 명령 전 거절", async () => {
  const before = commands.length;
  for (const quantity of [0, -1, 1.5, 100, Number.NaN]) {
    await assert.rejects(
      adapter.createCanonicalPurchase({ ...purchase, quantity }),
      /수량/,
    );
  }
  await assert.rejects(
    adapter.createCanonicalPurchase({ ...purchase, quantity: 5 }),
    /재고/,
  );
  await assert.rejects(
    adapter.createCanonicalPurchase({ ...purchase, expectedPrice: 100 }),
    /가격이 변경/,
  );
  assert.equal(commands.length, before);
});
await check("승인 전 자기 주문 취소에는 최신 주문 revision 사용", async () => {
  adapterState = {
    ...state(),
    orders: [{ orderId: "pending", status: "REQUESTED", revision: 7 }],
  };
  await adapter.cancelCanonicalPurchase(purchase.config, "pending");
  assert.equal(commands.at(-1).commandType, "cancelWisOrder");
  assert.equal(commands.at(-1).payload.expectedOrderRevision, 7);
});
await check(
  "승인·준비·지급·취소 주문 및 없는 주문은 학생 취소 불가",
  async () => {
    const before = commands.length;
    for (const status of ["APPROVED", "READY", "FULFILLED", "CANCELLED"]) {
      adapterState = {
        ...state(),
        orders: [{ orderId: "closed", status, revision: 8 }],
      };
      await assert.rejects(
        adapter.cancelCanonicalPurchase(purchase.config, "closed"),
        /승인 전/,
      );
    }
    await assert.rejects(
      adapter.cancelCanonicalPurchase(purchase.config, "missing"),
      /승인 전/,
    );
    assert.equal(commands.length, before);
  },
);
const archiveReads = [];
const archiveDatabase = new Map();
const archiveFailures = new Map();
let switchOwnerAfterRead = false;
const legacyProductPath = "years/2025/semesters/2/point_products";
const legacyOrderPath = "years/2025/semesters/2/point_orders";
const document = (id, row) => ({ id, data: () => row });
const resetArchive = () => {
  archiveReads.length = 0;
  archiveDatabase.clear();
  archiveFailures.clear();
};
const makeArchive = (enabled) =>
  load("src/lib/pointShopArchive.ts", {
    "./firebase": { auth, db: {} },
    "./semesterArchive": {
      isSemesterArchive: enabled,
      archiveScope: { year: "2025", semester: "2" },
    },
    "firebase/firestore": {
      collection: (_db, collectionPath) => ({ path: collectionPath }),
      orderBy: (field) => ({ orderBy: field }),
      where: (field, operator, value) => ({ field, operator, value }),
      startAfter: (row) => ({ after: row.id }),
      limit: (count) => ({ limit: count }),
      query: (ref, ...constraints) => ({ ...ref, constraints }),
      getDocs: async (request) => {
        archiveReads.push(request);
        if (archiveFailures.has(request.path))
          throw archiveFailures.get(request.path);
        let archiveRows = archiveDatabase.get(request.path) || [];
        for (const constraint of request.constraints) {
          if (constraint.field) {
            assert.equal(constraint.operator, "==");
            archiveRows = archiveRows.filter(
              (row) => row.data()[constraint.field] === constraint.value,
            );
          }
        }
        archiveRows = [...archiveRows].sort((a, b) => a.id.localeCompare(b.id));
        const after = request.constraints.find((item) => item.after)?.after;
        const index = after
          ? archiveRows.findIndex((row) => row.id === after) + 1
          : 0;
        const docs = archiveRows.slice(index, index + 200);
        if (switchOwnerAfterRead)
          auth.currentUser = { ...auth.currentUser, uid: "changed-owner" };
        return { docs, size: docs.length };
      },
    },
  });
const archive = makeArchive(true);
await check(
  "이전 학기 상품은 canonical 재고 snapshot을 우선하고 선택 학기로 201개 페이지 처리",
  async () => {
    resetArchive();
    archiveDatabase.set("semester_wis_inventory", [
      ...Array.from({ length: 201 }, (_, index) =>
        document(`inventory-${String(index).padStart(3, "0")}`, {
          semesterId: "2025-2",
          productId: `canonical-${index}`,
          productName: `당시 상품 ${index}`,
          productDescription: "당시 설명",
          productImageUrl: "archived-detail.webp",
          productPreviewImageUrl: "archived-preview.webp",
          productSortOrder: 201 - index,
          price: 120,
          stock: 10,
          available: 4,
          reserved: 2,
          sold: 4,
          active: true,
        }),
      ),
      document("another-semester", {
        semesterId: "2026-1",
        productId: "must-not-appear",
        productName: "다른 학기",
      }),
    ]);
    archiveDatabase.set(legacyProductPath, [
      document("legacy-only", { name: "혼합 금지" }),
    ]);
    const products = await archive.readArchivedShopProducts();
    assert.equal(products.length, 201);
    assert.equal(products[0].id, "canonical-200");
    assert.equal(products[0].name, "당시 상품 200");
    assert.equal(products[0].description, "당시 설명");
    assert.equal(products[0].imageUrl, "archived-detail.webp");
    assert.equal(products[0].previewImageUrl, "archived-preview.webp");
    assert.equal(products[0].stock, 10);
    assert.equal(products[0].availableStock, 4);
    assert.equal(products[0].reservedStock, 2);
    assert.equal(products[0].soldStock, 4);
    assert.equal(products[0].readOnly, true);
    assert.equal(archiveReads.length, 2);
    for (const read of archiveReads) {
      assert.equal(read.path, "semester_wis_inventory");
      assert.equal(
        read.constraints.find((item) => item.field)?.field,
        "semesterId",
      );
      assert.equal(
        read.constraints.find((item) => item.field)?.value,
        "2025-2",
      );
    }
    assert.equal(
      archiveReads[1].constraints.find((item) => item.after)?.after,
      "inventory-199",
    );
  },
);
await check(
  "이전 canonical 주문은 당시 학생·수량·금액·메모·준비시각을 보존하며 legacy와 섞지 않음",
  async () => {
    resetArchive();
    archiveDatabase.set("semester_wis_orders", [
      document("older", {
        semesterId: "2025-2",
        studentUid: "old-student",
        studentName: "당시 학생",
        grade: "2",
        class: "3",
        number: "9",
        productId: "old-product",
        productName: "당시 상품",
        productImageUrl: "old-photo.webp",
        quantity: 2,
        unitPrice: 120,
        totalPrice: 240,
        status: "READY",
        createdAt: { seconds: 100 },
        approvedAt: { seconds: 101 },
        readyAt: { seconds: 102 },
        memo: "학생 원본",
        reviewReason: "교사 원본",
      }),
      document("newer", {
        semesterId: "2025-2",
        status: "CANCELLED",
        createdAt: { _seconds: 200 },
        cancelledAt: { seconds: 201 },
      }),
      document("wrong-semester", {
        semesterId: "2026-1",
        createdAt: { seconds: 999 },
      }),
    ]);
    archiveDatabase.set(legacyOrderPath, [
      document("legacy-only", { productName: "혼합 금지" }),
    ]);
    const orders = await archive.readArchivedShopOrders();
    assert.equal(orders.length, 2);
    assert.equal(orders[0].id, "newer");
    assert.equal(orders[0].status, "cancelled");
    assert.equal(orders[1].uid, "old-student");
    assert.equal(orders[1].studentName, "당시 학생");
    assert.equal(orders[1].grade, "2");
    assert.equal(orders[1].class, "3");
    assert.equal(orders[1].number, "9");
    assert.equal(orders[1].quantity, 2);
    assert.equal(orders[1].unitPrice, 120);
    assert.equal(orders[1].priceSnapshot, 240);
    assert.equal(orders[1].status, "ready");
    assert.equal(orders[1].readyAt.seconds, 102);
    assert.equal(orders[1].memo, "학생 원본");
    assert.equal(orders[1].reviewReason, "교사 원본");
    assert.equal(orders[1].productImageUrl, "old-photo.webp");
    assert.equal(orders[1].readOnly, true);
    assert.equal(archiveReads.length, 1);
    assert.equal(archiveReads[0].path, "semester_wis_orders");
    assert.equal(
      archiveReads[0].constraints.find((item) => item.field)?.value,
      "2025-2",
    );
  },
);
await check(
  "canonical 상품이 비어 있을 때만 선택 학기 legacy 상품 201개로 fallback",
  async () => {
    resetArchive();
    archiveDatabase.set(
      legacyProductPath,
      Array.from({ length: 201 }, (_, index) => ({
        id: `product-${String(index).padStart(3, "0")}`,
        data: () => ({
          name: `상품 ${index}`,
          stock: 2,
          price: 100,
          sortOrder: 201 - index,
          imageUrl: `detail-${index}.webp`,
        }),
      })),
    );
    const products = await archive.readArchivedShopProducts();
    assert.equal(products.length, 201);
    assert.equal(products[0].id, "product-200");
    assert.equal(products[0].imageUrl, "detail-200.webp");
    assert.equal(products[0].readOnly, true);
    assert.equal(archiveReads.length, 3);
    assert.equal(archiveReads[0].path, "semester_wis_inventory");
    assert.ok(
      archiveReads
        .slice(1)
        .every((read) => read.path === "years/2025/semesters/2/point_products"),
    );
    assert.equal(
      archiveReads[2].constraints.find((item) => item.after)?.after,
      "product-199",
    );
  },
);
await check(
  "canonical 주문이 비어 있을 때만 legacy의 원본 메모·상태·시각을 최신순 표시",
  async () => {
    resetArchive();
    archiveDatabase.set(legacyOrderPath, [
      {
        id: "old",
        data: () => ({
          productName: "노트",
          memo: "원본 메모",
          status: "fulfilled",
          requestedAt: { seconds: 100 },
        }),
      },
      {
        id: "recent",
        data: () => ({
          productName: "연필",
          status: "rejected",
          requestedAt: { seconds: 200 },
        }),
      },
    ]);
    const orders = await archive.readArchivedShopOrders();
    assert.equal(orders[0].id, "recent");
    assert.equal(orders[1].memo, "원본 메모");
    assert.equal(orders[1].status, "fulfilled");
    assert.equal(orders[1].quantity, 1);
    assert.equal(orders[1].readOnly, true);
    assert.equal(archiveReads.length, 2);
    assert.equal(archiveReads[0].path, "semester_wis_orders");
    assert.equal(
      archiveReads.at(-1).path,
      "years/2025/semesters/2/point_orders",
    );
  },
);
await check("canonical 권한 오류는 legacy fallback 없이 전파", async () => {
  for (const [canonicalPath, read] of [
    ["semester_wis_inventory", archive.readArchivedShopProducts],
    ["semester_wis_orders", archive.readArchivedShopOrders],
  ]) {
    resetArchive();
    const denied = Object.assign(new Error("Synthetic permission denied"), {
      code: "permission-denied",
    });
    archiveFailures.set(canonicalPath, denied);
    archiveDatabase.set(legacyProductPath, [
      document("legacy-product", { name: "대체 조회 금지" }),
    ]);
    archiveDatabase.set(legacyOrderPath, [
      document("legacy-order", { productName: "대체 조회 금지" }),
    ]);
    await assert.rejects(read(), (error) => error === denied);
    assert.equal(archiveReads.length, 1);
    assert.equal(archiveReads[0].path, canonicalPath);
  }
  resetArchive();
});
await check(
  "이전 학기 조회가 아니면 직접조회 차단, 읽는 동안 계정 변경도 거절",
  async () => {
    const before = archiveReads.length;
    await assert.rejects(
      makeArchive(false).readArchivedShopProducts(),
      /학기를 확인/,
    );
    assert.equal(archiveReads.length, before);
    const owner = auth.currentUser;
    switchOwnerAfterRead = true;
    await assert.rejects(archive.readArchivedShopProducts(), /계정이 바뀌/);
    switchOwnerAfterRead = false;
    auth.currentUser = owner;
  },
);
const images = load("src/lib/pointProductImages.ts", {
  "./pointProductWatermark": load("src/lib/pointProductWatermark.ts", {
    // These cases test image URL selection, not browser canvas rendering.
    "./brandWatermark": {
      prepareBrandWatermark: () => {
        throw new Error("Unexpected image conversion");
      },
      drawBrandWatermark: () => {
        throw new Error("Unexpected image conversion");
      },
    },
  }),
});
await check(
  "기존 저해상도 미리보기 대신 상세이미지, 새 640px 미리보기는 목록 전용 사용",
  () => {
    assert.equal(
      images.getProductCardImage({
        imageUrl: "detail.webp",
        previewImageUrl: "preview-320-old.webp",
      }),
      "detail.webp",
    );
    assert.equal(
      images.getProductCardImage({
        imageUrl: "detail.webp",
        previewImageUrl: "preview-640-new.webp",
      }),
      "preview-640-new.webp",
    );
    assert.equal(
      images.getProductCardImage({
        imageUrl: "",
        previewImageUrl: "old-only.webp",
      }),
      "old-only.webp",
    );
    assert.equal(images.getProductCardImage({ imageUrl: "" }), "");
  },
);
console.log(
  `위스 상점 클라이언트 검증 ${checks}개 통과 (합성 transport, Firebase 연결 없음)`,
);
