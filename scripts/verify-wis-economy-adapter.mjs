import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash, webcrypto } from "node:crypto";
import ts from "typescript";

// Optionally validate every generated payload against a read-only deployed
// source archive. No Firebase runtime or credentials are loaded.
let deployedContract;
if (process.env.WIS_ADAPTER_CONTRACT_PATH) {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(process.env.WIS_ADAPTER_CONTRACT_PATH, "utf8") +
      "\nmodule.exports.normalizeQueryForTest = normalizeQuery;",
    {
      module,
      require: (name) => {
        if (name === "node:crypto") return { createHash };
        if (name === "firebase-functions/v2/https")
          return {
            HttpsError: class extends Error {
              constructor(code, message, details) {
                super(message);
                this.code = code;
                this.details = details;
              }
            },
          };
        if (name === "./semesterCore")
          return { normalizeSemesterId: (value) => value };
        return {};
      },
    },
  );
  deployedContract = module.exports;
}

// Execute the real adapters against synthetic canonical query/command services.
// No Firebase SDK, credentials, browser automation or production calls.
const compile = (name) =>
  ts.transpileModule(
    fs.readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const account = {
  accountId: "account-a",
  studentUid: "student-a",
  displayName: "합성학생",
  grade: "1",
  classNumber: "2",
  studentNumber: "3",
  balance: 140,
  earnedTotal: 150,
  rankEarnedTotal: 130,
  spentTotal: 10,
  adjustedTotal: 0,
  revision: 4,
};
const state = (extra = {}) => ({
  semesterId: "2026-2",
  manifestRevision: 7,
  readOnly: false,
  economy: { revision: 8, status: "ACTIVE_OPEN" },
  account,
  accounts: [account],
  ledger: [],
  products: [],
  inventory: [],
  orders: [],
  hallOfFame: null,
  hallOfFameConfigRevision: 3,
  nextCursor: "",
  ...extra,
});
const product = {
  productId: "p1",
  revision: 2,
  name: "합성상품",
  description: "",
  imageUrl: "",
  active: true,
};
const inventory = {
  inventoryId: "i1",
  productId: "p1",
  revision: 3,
  price: 20,
  stock: 5,
  available: 4,
  reserved: 1,
  active: true,
};
const config = { year: "2026", semester: "2" };
const makeUser = (uid = "student-a", epoch = 10) => ({
  uid,
  epoch,
  getIdTokenResult: async function () {
    return { claims: { auth_time: this.epoch } };
  },
});
function harness(service = async () => state(), sharedStorage = new Map()) {
  const auth = { currentUser: makeUser() },
    calls = [],
    storage = sharedStorage,
    modules = {},
    sensitive = [];
  const deps = {
    "./firebase": { auth },
    "./historyDictionarySession": {
      getHistoryDictionaryCallable: async (name) => async (payload) => {
        if (deployedContract && name === "executeCommand")
          deployedContract.normalizeWisPayload(
            payload.commandType,
            payload.payload,
          );
        if (deployedContract && name === "getWisEconomyState")
          deployedContract.normalizeQueryForTest(payload);
        calls.push({ name, payload });
        return { data: await service(name, payload) };
      },
    },
    "./semesterScope": { getYearSemester: (input) => input || config },
    "./points": {
      getPointPolicy: async () => ({ rankPolicy: {} }),
      getPointRankManualAdjustEarnedPointsByUid: async () => {
        throw Error("Legacy rank fallback must not run");
      },
    },
    "./pointRanks": {
      needsPointRankLegacyFallback: () => false,
      getPointRankDisplay: ({ wallet }) => ({ balance: wallet?.balance }),
    },
    "./sensitiveOperation": {
      ensureSensitiveOperation: async () =>
        sensitive.push(auth.currentUser.uid),
    },
    "./safeStorage": {
      readStorage: (key) => storage.get(key) || null,
      writeStorage: (key, value) => storage.set(key, value),
      removeStorage: (key) => storage.delete(key),
    },
    "firebase/firestore": {
      Timestamp: class {
        static fromMillis(value) {
          return new this(Math.floor(value / 1000), (value % 1000) * 1e6);
        }
        constructor(seconds, nanoseconds) {
          this.seconds = seconds;
          this.nanoseconds = nanoseconds;
        }
        toMillis() {
          return this.seconds * 1000 + this.nanoseconds / 1e6;
        }
      },
    },
  };
  const load = (name) => {
    if (modules[name]) return modules[name];
    const exports = {};
    modules[name] = exports;
    vm.runInNewContext(compile(name), {
      exports,
      require: (name) => {
        if (name in deps) return deps[name];
        if (name.startsWith("./")) return load(name.slice(2));
        throw Error(`Unexpected dependency ${name}`);
      },
      crypto: webcrypto,
      TextEncoder,
      console,
    });
    return exports;
  };
  return {
    auth,
    calls,
    storage,
    sensitive,
    client: load("wisEconomyClient"),
    student: load("studentWis"),
    adapter: load("pointEconomyAdapter"),
    promotion: load("pointRankPromotion"),
    reload: () => harness(service, storage),
  };
}
let count = 0;
const test = async (name, run) => {
  try {
    await run();
    count++;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
};
await test("Own student reads deduplicate pending work and use canonical scope", async () => {
  const gate = deferred(),
    h = harness(async () => gate.promise);
  const one = h.student.getStudentPointWallet(config, "student-a"),
    two = h.student.listStudentPointTransactions(config, "student-a");
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, "getWisEconomyState");
  assert.equal(h.calls[0].payload.audience, "student");
  assert.equal(h.calls[0].payload.source, "CURRENT");
  gate.resolve(state());
  const [wallet] = await Promise.all([one, two]);
  assert.equal(wallet.balance, 140);
  assert.equal(wallet.rankEarnedTotal, 130);
  assert.equal(wallet.class, "2");
  await h.student.getStudentPointWallet(config, "student-a");
  assert.equal(
    h.calls.length,
    2,
    "Settled results are not cached across sessions",
  );
});
for (const change of ["account", "same-uid-object", "epoch"])
  await test(`Stale query rejects ${change}`, async () => {
    const gate = deferred(),
      h = harness(async () => gate.promise);
    const pending = h.student.getStudentPointWallet(config, "student-a");
    for (let i = 0; i < 20; i++) await Promise.resolve();
    if (change === "epoch") h.auth.currentUser.epoch++;
    else
      h.auth.currentUser = makeUser(
        change === "account" ? "student-b" : "student-a",
      );
    gate.resolve(state());
    await assert.rejects(pending);
  });
for (const response of [
  state({ semesterId: "2025-1" }),
  state({ account: { ...account, studentUid: "student-b" } }),
])
  await test("Mismatched server scope fails closed", async () => {
    const h = harness(async () => response);
    await assert.rejects(h.student.getStudentPointWallet(config, "student-a"));
  });
await test("Denied queries never read retired wallets", async () => {
  const h = harness(async () => {
    throw Object.assign(Error("denied"), {
      code: "functions/permission-denied",
    });
  });
  await assert.rejects(h.student.getStudentPointWallet(config, "student-a"));
  assert.equal(h.calls.length, 1);
});
await test("Projection activity, timestamps and private order uid map correctly", async () => {
  const h = harness(async () =>
    state({
      ledger: [
        {
          ledgerEntryId: "l1",
          type: "GRANT",
          activityType: "history_dictionary",
          delta: 2,
          balanceAfter: 140,
          createdAt: { _seconds: 123, _nanoseconds: 456 },
        },
      ],
      orders: [
        {
          orderId: "o1",
          productId: "p1",
          productName: "상품",
          totalPrice: 20,
          status: "REQUESTED",
          createdAt: { seconds: 123 },
        },
      ],
    }),
  );
  const entries = await h.student.listStudentPointTransactions(
    config,
    "student-a",
  );
  assert.equal(entries[0].activityType, "history_dictionary");
  assert.equal(entries[0].createdAt.toMillis(), 123000.000456);
  const orders = await h.student.listStudentPointOrders(config);
  assert.equal(orders[0].uid, "student-a");
  assert.equal(orders[0].status, "requested");
  assert.equal(orders[0].studentName, "합성학생");
});
await test("Stock and visibility honor audience, including sold out products", async () => {
  const h = harness(async () =>
    state({
      products: [product, { ...product, productId: "hidden", active: false }],
      inventory: [
        { ...inventory, available: 0 },
        { ...inventory, productId: "hidden" },
      ],
    }),
  );
  const student = await h.student.listStudentPointProducts(config);
  assert.equal(student.length, 1);
  assert.equal(student[0].stock, 0);
  const teacher = await h.adapter.listCanonicalPointProducts(config);
  assert.equal(teacher.length, 2);
  assert.equal(teacher[0].stock, 5);
});
await test("Teacher lists follow cursors and preserve approval boundaries", async () => {
  const h = harness(async (name, payload) =>
    state(
      payload.cursor
        ? { accounts: [{ ...account, studentUid: "student-b" }] }
        : { nextCursor: "cursor-2" },
    ),
  );
  h.auth.currentUser = makeUser("teacher");
  const wallets = await h.adapter.listCanonicalPointWallets(config);
  assert.equal(wallets.length, 2);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].payload.cursor, "cursor-2");
  assert.ok(h.calls.every((call) => call.payload.audience === "teacher"));
});
await test("Purchase uses revisions and remains idempotent after UI refresh failure", async () => {
  const h = harness(async (name) =>
    name === "getWisEconomyState"
      ? state({ products: [product], inventory: [inventory] })
      : {
          status: "SUCCEEDED",
          result: { orderId: "order1", ledgerEntryId: "debit1", balance: 120 },
        },
  );
  const input = {
    config,
    productId: "p1",
    requestKey: "request1",
    memo: "합성요청",
  };
  await h.adapter.createCanonicalPurchase(input);
  await h.adapter.createCanonicalPurchase(input);
  const commands = h.calls.filter((item) => item.name === "executeCommand");
  assert.equal(commands.length, 1);
  assert.equal(commands[0].payload.commandType, "placeWisOrder");
  const payload = commands[0].payload.payload;
  assert.equal(payload.expectedSemesterRevision, 7);
  assert.equal(payload.expectedEconomyRevision, 8);
  assert.equal(payload.expectedAccountRevision, 4);
  assert.equal(payload.expectedInventoryRevision, 3);
  assert.equal(payload.quantity, 1);
  assert.equal(h.sensitive.length, 0);
});
await test("Lost command response recovers receipt without replay mutation", async () => {
  const h = harness(async (name) => {
    if (name === "getWisEconomyState")
      return state({ products: [product], inventory: [inventory] });
    if (name === "executeCommand")
      throw Object.assign(Error("lost"), { code: "functions/unavailable" });
    return {
      status: "SUCCEEDED",
      result: { orderId: "receipt-order", balance: 120 },
    };
  });
  const result = await h.adapter.createCanonicalPurchase({
    config,
    productId: "p1",
    requestKey: "receipt",
  });
  assert.equal(result.orderId, "receipt-order");
  assert.equal(
    h.calls.filter((call) => call.name === "executeCommand").length,
    1,
  );
  assert.equal(
    h.calls.filter((call) => call.name === "getCommandStatus").length,
    1,
  );
});
await test("Unknown outcome retains exact command and revisions on user retry", async () => {
  let fail = true;
  const h = harness(async (name) => {
    if (name === "getWisEconomyState")
      return state({ products: [product], inventory: [inventory] });
    if (fail)
      throw Object.assign(Error("offline"), { code: "functions/unavailable" });
    return {
      status: "SUCCEEDED",
      result: { orderId: "retry-order", balance: 120 },
    };
  });
  const input = { config, productId: "p1", requestKey: "retry" };
  await assert.rejects(h.adapter.createCanonicalPurchase(input));
  fail = false;
  await h.adapter.createCanonicalPurchase(input);
  const commands = h.calls.filter((call) => call.name === "executeCommand");
  assert.equal(commands.length, 2);
  assert.equal(JSON.stringify(commands[0]), JSON.stringify(commands[1]));
  assert.equal(
    h.calls.filter((call) => call.name === "getWisEconomyState").length,
    1,
  );
});
await test("Product resumes after acknowledged metadata and unknown inventory", async () => {
  let fail = true;
  const h = harness(async (name, payload) => {
    if (name === "getWisEconomyState")
      return state({ account: null, accounts: [] });
    if (name === "getCommandStatus")
      throw Object.assign(Error("offline"), { code: "functions/unavailable" });
    if (payload.commandType === "upsertWisProduct")
      return {
        status: "SUCCEEDED",
        result: {
          productId: payload.payload.productId,
          revision: 1,
          inventoryRevision: null,
        },
      };
    if (fail)
      throw Object.assign(Error("lost"), { code: "functions/unavailable" });
    return { status: "SUCCEEDED", result: { revision: 1 } };
  });
  h.auth.currentUser = makeUser("teacher");
  const product = { name: "상품", price: 10, stock: 4 };
  await assert.rejects(
    h.adapter.upsertCanonicalPointProduct(config, product, { uid: "teacher" }),
  );
  fail = false;
  const saved = await h.adapter.upsertCanonicalPointProduct(config, product, {
    uid: "teacher",
  });
  assert.ok(saved.id);
  assert.equal(
    h.calls.filter((call) => call.payload.commandType === "upsertWisProduct")
      .length,
    1,
  );
  const inventoryCommands = h.calls.filter(
    (call) =>
      call.name === "executeCommand" &&
      call.payload.commandType === "upsertWisInventory",
  );
  assert.equal(inventoryCommands.length, 2);
  assert.equal(
    inventoryCommands[0].payload.commandId,
    inventoryCommands[1].payload.commandId,
  );
  assert.equal(h.sensitive.length, 2);
});
await test("Manual correction resumes only replacement after a completed reverse", async () => {
  let fail = true;
  const h = harness(async (name, payload) => {
    if (name === "getWisEconomyState")
      return state({
        ledger: [{ ledgerEntryId: "old", type: "GRANT", delta: 10 }],
      });
    if (name === "getCommandStatus")
      throw Object.assign(Error("offline"), { code: "functions/unavailable" });
    if (payload.commandType === "reverseWisEntry")
      return {
        status: "SUCCEEDED",
        result: { accountId: "account-a", balance: 130 },
      };
    if (fail)
      throw Object.assign(Error("offline"), { code: "functions/unavailable" });
    return {
      status: "SUCCEEDED",
      result: { accountId: "account-a", ledgerEntryId: "new", balance: 145 },
    };
  });
  h.auth.currentUser = makeUser("teacher");
  const input = {
    config,
    transactionId: "old",
    action: "update",
    nextDelta: 15,
  };
  await assert.rejects(h.adapter.updateCanonicalPointAdjustment(input));
  const recovery = h.adapter.getPendingCanonicalPointAdjustment(config);
  assert.equal(recovery.transactionId, "old");
  assert.equal(recovery.nextDelta, 15);
  await assert.rejects(
    h.adapter.updateCanonicalPointAdjustment({ ...input, nextDelta: 20 }),
    /이전 조정/,
  );
  h.auth.currentUser = makeUser("other-teacher");
  assert.equal(h.adapter.getPendingCanonicalPointAdjustment(config), null);
  h.auth.currentUser = makeUser("teacher");
  assert.equal(
    h.adapter.getPendingCanonicalPointAdjustment({
      year: "2026",
      semester: "1",
    }),
    null,
  );
  fail = false;
  const reloaded = h.reload();
  reloaded.auth.currentUser = makeUser("teacher");
  const result = await reloaded.adapter.updateCanonicalPointAdjustment({
    config,
    ...reloaded.adapter.getPendingCanonicalPointAdjustment(config),
  });
  assert.equal(result.balance, 145);
  assert.equal(
    reloaded.adapter.getPendingCanonicalPointAdjustment(config),
    null,
  );
  assert.equal(
    reloaded.calls.filter(
      (call) => call.payload.commandType === "reverseWisEntry",
    ).length,
    0,
  );
  assert.equal(
    h.calls.filter((call) => call.payload.commandType === "reverseWisEntry")
      .length,
    1,
  );
  const grants = [...h.calls, ...reloaded.calls].filter(
    (call) =>
      call.name === "executeCommand" && call.payload.commandType === "grantWis",
  );
  assert.equal(grants.length, 2);
  assert.equal(grants[0].payload.commandId, grants[1].payload.commandId);
});

await test("Purchase refuses a price changed since student confirmation", async () => {
  const h = harness(async () =>
    state({ products: [product], inventory: [inventory] }),
  );
  await assert.rejects(
    h.adapter.createCanonicalPurchase({
      config,
      productId: "p1",
      expectedPrice: 10,
      requestKey: "price",
    }),
    /가격/,
  );
  assert.equal(h.calls.filter((c) => c.name === "executeCommand").length, 0);
});
await test("Hall query converts ISO timestamps and keeps canonical masked identities", async () => {
  const snapshot = {
    snapshotVersion: 7,
    updatedAt: "2026-10-08T04:00:00.000Z",
    gradeTop3ByGrade: { 1: [{ uid: "wispublic_masked" }] },
  };
  const h = harness(async () => state({ hallOfFame: snapshot }));
  const result = await h.student.getStudentPointHallOfFame(config);
  assert.equal(result.updatedAt.toMillis(), Date.parse(snapshot.updatedAt));
  assert.equal(result.gradeTop3ByGrade["1"][0].uid, "wispublic_masked");
});
await test("Hall config command uses protected session and exact canonical revisions", async () => {
  const h = harness(async (name, payload) =>
    name === "getWisEconomyState"
      ? state()
      : {
          status: "SUCCEEDED",
          result: {
            hallOfFame: payload.payload.hallOfFame,
            hallOfFameRevision: 4,
          },
        },
  );
  h.auth.currentUser = makeUser("teacher");
  const result = await h.adapter.saveCanonicalWisHallOfFameConfig(config, {});
  assert.equal(result.saved, true);
  assert.equal(h.sensitive.length, 1);
  const payload = h.calls.find((c) => c.name === "executeCommand").payload;
  assert.equal(payload.commandType, "saveWisHallOfFameConfig");
  assert.equal(payload.payload.expectedHallOfFameRevision, 3);
  assert.equal(payload.payload.expectedEconomyRevision, 8);
});
await test("Confirmed revision conflict refreshes only an uncommitted command", async () => {
  let failure = true;
  const h = harness(async (name) => {
    if (name === "getWisEconomyState")
      return state({ products: [product], inventory: [inventory] });
    if (failure)
      throw Object.assign(Error("conflict"), {
        code: "functions/aborted",
        details: { reason: "WIS_ACCOUNT_REVISION_CONFLICT" },
      });
    return { status: "SUCCEEDED", result: { orderId: "ok" } };
  });
  const input = { config, productId: "p1", requestKey: "revision" };
  await assert.rejects(h.adapter.createCanonicalPurchase(input));
  failure = false;
  await h.adapter.createCanonicalPurchase(input);
  const commands = h.calls.filter((c) => c.name === "executeCommand");
  assert.notEqual(commands[0].payload.commandId, commands[1].payload.commandId);
  assert.equal(
    h.calls.filter((c) => c.name === "getWisEconomyState").length,
    2,
  );
});

await test("Promotion cache cannot return another login's wallet", async () => {
  const h = harness();
  const first = await h.promotion.loadStudentRankPromotionSnapshot(
    config,
    "student-a",
  );
  assert.equal(first.wallet.balance, 140);
  h.auth.currentUser = makeUser("student-b");
  await assert.rejects(
    h.promotion.loadStudentRankPromotionSnapshot(config, "student-a"),
  );
  h.auth.currentUser = makeUser("student-a");
  await h.promotion.loadStudentRankPromotionSnapshot(config, "student-a");
  assert.equal(
    h.calls.length,
    2,
    "A new auth instance cannot reuse old rank data",
  );
  h.auth.currentUser.epoch++;
  await h.promotion.loadStudentRankPromotionSnapshot(config, "student-a");
  assert.equal(
    h.calls.length,
    3,
    "A refreshed authentication epoch invalidates cached data",
  );
});
await test("Teacher review maps allowed order transitions to protected commands", async () => {
  const h = harness(async (name) =>
    name === "getWisEconomyState"
      ? state({ orders: [{ orderId: "o1", revision: 9, status: "REQUESTED" }] })
      : { status: "SUCCEEDED", result: { orderId: "o1", status: "APPROVED" } },
  );
  h.auth.currentUser = makeUser("teacher");
  await h.adapter.reviewCanonicalPointOrder({
    config,
    orderId: "o1",
    nextStatus: "approved",
    actor: { uid: "teacher" },
  });
  assert.equal(h.sensitive.length, 1);
  const command = h.calls.find((c) => c.name === "executeCommand").payload;
  assert.equal(command.commandType, "reviewWisOrder");
  assert.equal(command.payload.action, "APPROVE");
  assert.equal(command.payload.expectedOrderRevision, 9);
  await assert.rejects(
    h.adapter.reviewCanonicalPointOrder({
      config,
      orderId: "o1",
      nextStatus: "requested",
      actor: { uid: "teacher" },
    }),
  );
});
await test("Teacher grants and deductions preserve integer amount and target account", async () => {
  const h = harness(async (name) =>
    name === "getWisEconomyState"
      ? state()
      : {
          status: "SUCCEEDED",
          result: { accountId: "account-a", ledgerEntryId: "l1", balance: 150 },
        },
  );
  h.auth.currentUser = makeUser("teacher");
  for (const delta of [10, -5])
    await h.adapter.adjustCanonicalPoints({
      config,
      uid: "student-a",
      delta,
      sourceId: "manual-" + delta,
      actor: { uid: "teacher" },
    });
  const commands = h.calls.filter((c) => c.name === "executeCommand");
  assert.equal(commands[0].payload.commandType, "grantWis");
  assert.equal(commands[1].payload.commandType, "deductWis");
  assert.equal(commands[1].payload.payload.amount, 5);
  assert.equal(commands[1].payload.payload.accountId, "account-a");
  await assert.rejects(
    h.adapter.adjustCanonicalPoints({
      config,
      uid: "student-a",
      delta: 0.5,
      actor: { uid: "teacher" },
    }),
  );
});
console.log(
  `Wis canonical adapters: ${count} deterministic scope, display, purchase and recovery cases passed. No Firebase/production calls.`,
);
