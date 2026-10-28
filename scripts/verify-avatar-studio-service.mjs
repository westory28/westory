import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

// Exercise the real authenticated client without touching Firebase or a wallet.
const root = fileURLToPath(new URL("../", import.meta.url));
const calls = [];
const responses = new Map();
let epoch = 10;
const owner = {
  uid: "avatar-client-test",
  getIdTokenResult: async () => ({ claims: { auth_time: epoch } }),
};
const runtime = {
  auth: { currentUser: owner },
  pointsUpdated: 0,
  avatarUpdated: 0,
  getCallable: async (name) => async (payload) => {
    calls.push({ name, payload });
    assert.ok(responses.has(name), `Unexpected callable: ${name}`);
    return { data: await responses.get(name)(payload) };
  },
};
const { outputFiles } = await build({
  entryPoints: ["src/features/avatar/service.ts"],
  absWorkingDir: root,
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [
    {
      name: "avatar-client-boundaries",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /\/(firebase|historyDictionarySession|appEvents)$|^\.\/events$/,
          },
          ({ path }) => ({ path, namespace: "avatar-test" }),
        );
        builder.onLoad(
          { filter: /.*/, namespace: "avatar-test" },
          ({ path }) => ({
            contents: path.endsWith("firebase")
              ? "export const auth = globalThis.__runtime.auth;"
              : path.endsWith("historyDictionarySession")
                ? "export const getHistoryDictionaryCallable = globalThis.__runtime.getCallable;"
                : path.endsWith("appEvents")
                  ? "export const notifyPointsUpdated = () => { globalThis.__runtime.pointsUpdated++; };"
                  : "export const notifyAvatarUpdated = () => { globalThis.__runtime.avatarUpdated++; };",
            loader: "js",
          }),
        );
      },
    },
  ],
});
const storage = new Map();
let digestGate;
const module = { exports: {} };
vm.runInNewContext(outputFiles[0].text, {
  module,
  exports: module.exports,
  require: createRequire(import.meta.url),
  __runtime: runtime,
  crypto: {
    randomUUID: () => webcrypto.randomUUID(),
    subtle: {
      digest: async (...args) => {
        if (digestGate) await digestGate;
        return webcrypto.subtle.digest(...args);
      },
    },
  },
  TextEncoder,
  URLSearchParams,
  sessionStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
});
const service = module.exports;
const scope = { year: "2026", semester: "2" };
const avatar = { revision: 4, look: { character: "boy" }, ownedItemIds: [] };
const pricing = { revision: 2, prices: { "top:test": 500 }, catalogVersion: 2 };
const wallet = {
  balance: 1000,
  earnedTotal: 1000,
  rankEarnedTotal: 1000,
  spentTotal: 0,
  revision: 1,
};
const studio = { avatar, pricing, balance: wallet.balance, wallet };
const flush = () => new Promise((resolve) => setImmediate(resolve));
const reset = () => {
  calls.length = 0;
  responses.clear();
};

// Multiple consumers share only an in-flight read; an explicit reopening sees current prices.
let releaseRead;
responses.set(
  "getAvatarStudioState",
  () =>
    new Promise((resolve) => {
      releaseRead = resolve;
    }),
);
const first = service.getAvatarStudioState(scope);
const concurrent = service.getAvatarStudioState(scope);
await flush();
assert.equal(calls.length, 1);
assert.equal(calls[0].name, "getAvatarStudioState");
assert.equal(calls[0].payload.year, "2026");
assert.equal(calls[0].payload.semester, "2");
releaseRead(studio);
assert.equal(await first, studio);
assert.equal(await concurrent, studio);
responses.set("getAvatarStudioState", async () => studio);
await service.getAvatarStudioState(scope);
assert.equal(
  calls.length,
  2,
  "Completed private state must not be cached across reopenings",
);

// Teacher profile + studio data comes from one endpoint, with no wallet or pricing query.
reset();
const teacher = {
  avatar,
  profileEmojiId: "smile",
  profileIcon: "😀",
  emojiRegistry: [],
  allAvailable: true,
};
responses.set("getTeacherMyPage", async () => teacher);
assert.equal(await service.getTeacherMyPage(scope), teacher);
assert.deepEqual(
  calls.map(({ name }) => name),
  ["getTeacherMyPage"],
);
responses.set("updateTeacherProfileIcon", async (payload) => ({
  emojiId: payload.emojiId,
  profileIcon: "😎",
}));
assert.equal(
  (await service.updateTeacherProfileIcon(scope, "cool")).emojiId,
  "cool",
);
assert.equal(calls.at(-1).payload.semester, "2");

// Displayed price and pricing revision travel with the purchase, and a stale quote never retries.
reset();
const changed = {
  code: "functions/failed-precondition",
  details: {
    reason: "AVATAR_PRICE_CHANGED",
    pricing: { ...pricing, revision: 3, prices: { "top:test": 700 } },
  },
};
responses.set("purchaseStudentAvatarItem", async () => {
  throw changed;
});
await assert.rejects(
  service.purchaseAvatarItem(scope, "top:test", 500, 2),
  (error) => error === changed,
);
assert.equal(calls.length, 1);
assert.equal(calls[0].payload.expectedPrice, 500);
assert.equal(calls[0].payload.expectedPricingRevision, 2);
const declinedRequestId = calls[0].payload.requestId;
assert.equal(service.avatarPricingFromError(changed).prices["top:test"], 700);
assert.match(service.avatarErrorMessage(changed), /가격이 변경/);
assert.equal(service.avatarPricingFromError(new Error("other failure")), null);
assert.equal(
  service.avatarPricingFromError({
    details: { reason: "AVATAR_ITEM_NOT_OWNED", pricing },
  }),
  pricing,
  "A free item changed to paid during editing must expose current prices after a rejected save",
);
responses.set("purchaseStudentAvatarItem", async () => ({
  itemId: "top:test",
  charged: 700,
  alreadyOwned: false,
  duplicate: false,
  avatar,
  wallet,
}));
await service.purchaseAvatarItem(scope, "top:test", 700, 3);
assert.equal(
  calls.length,
  2,
  "A second purchase happens only after an explicit new call",
);
assert.notEqual(calls[1].payload.requestId, declinedRequestId);
assert.equal(calls[1].payload.expectedPrice, 700);

// A retry after a network failure keeps its idempotency key, and duplicate recovery is one read.
reset();
responses.set("purchaseStudentAvatarItem", async () => {
  throw { code: "functions/unavailable" };
});
await assert.rejects(service.purchaseAvatarItem(scope, "top:test", 700, 3));
const retryId = calls[0].payload.requestId;
responses.set("purchaseStudentAvatarItem", async () => ({
  itemId: "top:test",
  charged: 700,
  alreadyOwned: false,
  duplicate: true,
  avatar: { ...avatar, revision: 3 },
  wallet: { ...wallet, balance: 300 },
}));
responses.set("getAvatarStudioState", async () => studio);
const duplicate = await service.purchaseAvatarItem(scope, "top:test", 700, 3);
assert.equal(calls[1].payload.requestId, retryId);
assert.deepEqual(
  calls.map(({ name }) => name),
  [
    "purchaseStudentAvatarItem",
    "purchaseStudentAvatarItem",
    "getAvatarStudioState",
  ],
);
assert.equal(duplicate.wallet, wallet);
assert.equal(duplicate.avatar, avatar);
assert.equal(duplicate.pricing, pricing);

// Responses from an account or authentication epoch that changed in flight are discarded.
for (const change of [
  () => {
    runtime.auth.currentUser = { ...owner, uid: "other" };
  },
  () => {
    epoch++;
  },
]) {
  reset();
  runtime.auth.currentUser = owner;
  responses.set(
    "getTeacherMyPage",
    () =>
      new Promise((resolve) => {
        releaseRead = resolve;
      }),
  );
  const stale = service.getTeacherMyPage(scope);
  await flush();
  change();
  releaseRead(teacher);
  await assert.rejects(stale, /로그인 계정이 바뀌/);
}
runtime.auth.currentUser = owner;

// Teacher save uses its own endpoint; a normal save never triggers profile or wallet reads.
reset();
responses.set("saveTeacherAvatar", async () => avatar);
assert.equal(
  await service.saveTeacherAvatar(scope, avatar.look, 3, "thumbnail-test"),
  avatar,
);
assert.deepEqual(
  calls.map(({ name }) => name),
  ["saveTeacherAvatar"],
);
assert.equal(calls[0].payload.expectedRevision, 3);

// Hashing a thumbnail yields; switching users during that work must not save the previous look as the new user.
for (const change of [
  () => {
    runtime.auth.currentUser = { ...owner, uid: "other" };
  },
  () => {
    epoch++;
  },
]) {
  reset();
  runtime.auth.currentUser = owner;
  let releaseDigest;
  digestGate = new Promise((resolve) => {
    releaseDigest = resolve;
  });
  const staleSave = service.saveTeacherAvatar(
    scope,
    avatar.look,
    3,
    "thumbnail-race",
  );
  await flush();
  change();
  releaseDigest();
  await assert.rejects(staleSave, /로그인 계정이 바뀌/);
  assert.equal(
    calls.length,
    0,
    "No mutation may start after the save owner changes",
  );
  digestGate = null;
}
runtime.auth.currentUser = owner;

// Admin changes carry the revision used by the editor to prevent overwriting newer prices.
reset();
responses.set("getAvatarCatalogPricing", async () => pricing);
responses.set("updateAvatarCatalogPricing", async () => ({
  ...pricing,
  revision: 3,
}));
assert.equal(await service.getAvatarCatalogPricing(), pricing);
assert.equal(
  (
    await service.updateAvatarCatalogPricing({
      expectedRevision: 2,
      prices: pricing.prices,
    })
  ).revision,
  3,
);
assert.equal(calls.at(-1).payload.expectedRevision, 2);
assert.equal(calls.at(-1).payload.prices["top:test"], 500);
console.log(
  "Avatar studio service: one-read loads, teacher access, quoted purchases, idempotency, and session isolation passed.",
);
