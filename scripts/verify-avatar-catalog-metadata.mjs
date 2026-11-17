import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const server = require("../functions/studentAvatarCatalog.js");
const bundled = await build({
  entryPoints: ["src/features/avatar/catalog.ts"],
  absWorkingDir: root,
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
});
const module = { exports: {} };
vm.runInNewContext(bundled.outputFiles[0].text, {
  module,
  exports: module.exports,
});
const client = module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
for (const item of client.AVATAR_ITEMS) {
  const base = plain(item);
  assert.deepEqual(
    plain(client.avatarItemMetadata(item)),
    server.itemMetadata(base),
    item.id,
  );
  const metadata = {
    label: `수정 ${item.label}`,
    gender: "unisex",
    description: "상품 설명\n둘째 줄",
  };
  const price = client.avatarItemPricePolicy(item) === "free" ? 0 : 435;
  const configured = client.applyAvatarCatalogSettings(item, {
    prices: { [item.id]: price },
    metadata: { [item.id]: metadata },
  });
  assert.deepEqual(plain(client.avatarItemMetadata(configured)), metadata);
  assert.equal(configured.price, price);
  assert.equal(configured.id, item.id);
  assert.equal(configured.slot, item.slot);
  assert.equal(configured.value, item.value);
  assert.equal(configured.minPurchaseTier, item.minPurchaseTier ?? "tier_1");
  const restricted = client.applyAvatarCatalogSettings(item, {
    prices: { [item.id]: 435 },
    purchaseTiers: { [item.id]: "tier_4" },
  });
  assert.equal(restricted.minPurchaseTier, restricted.price === 0 ? "tier_1" : "tier_4");
  for (const allowed of [null, undefined, [], ["tier_1"], ["tier_1", "tier_2", "tier_3"]])
    assert.equal(client.canPurchaseAvatarItem(restricted, allowed), restricted.price === 0);
  for (const allowed of [["tier_4"], ["tier_1", "tier_2", "tier_3", "tier_4", "tier_5"]])
    assert.equal(client.canPurchaseAvatarItem(restricted, allowed), true);
  assert.equal(
    configured.characters,
    item.characters,
    "Classification must not mutate body compatibility",
  );
  assert.deepEqual(
    plain(item),
    base,
    "Applying settings must leave the base catalog immutable",
  );
  assert.deepEqual(
    plain(
      client.avatarItemMetadata(
        client.applyAvatarCatalogSettings(item, { prices: {} }),
      ),
    ),
    server.itemMetadata(base),
  );
}
const owned = [client.AVATAR_ITEMS.find((item) => item.price > 0).id];
for (const invalid of [undefined, null, "tier_5", ["tier_6"], ["tier_1", "invalid"]])
  assert.equal(client.normalizeAvatarPurchaseTiers(invalid), null);
assert.deepEqual(plain(client.normalizeAvatarPurchaseTiers(["tier_1", "tier_4", "tier_1"])), ["tier_1", "tier_4"]);
const ownedBase = client.AVATAR_ITEMS.find((item) => item.id === owned[0]);
assert.equal(
  client.ownsAvatarItem(
    client.applyAvatarCatalogSettings(ownedBase, {
      prices: { [ownedBase.id]: 999 },
      purchaseTiers: { [ownedBase.id]: "tier_5" },
      metadata: {
        [ownedBase.id]: { label: "이름 변경", gender: "girl", description: "" },
      },
    }),
    owned,
  ),
  true,
);
console.log(
  `Avatar metadata: ${client.AVATAR_ITEMS.length} client/server defaults, classification isolation, effective prices and ownership passed.`,
);
