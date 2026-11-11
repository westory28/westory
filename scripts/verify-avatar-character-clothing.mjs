import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/features/avatar/catalog.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
});
const module = { exports: {} };
vm.runInNewContext(outputFiles[0].text, { module, exports: module.exports });
const {
  AVATAR_ITEMS,
  defaultAvatarLook,
  itemForLook,
  selectAvatarItem,
  restoreAvatarLook,
  restoreAvatarState,
  AVATAR_CATALOG_VERSION,
} = module.exports;
const skirts = AVATAR_ITEMS.filter(
  (item) => item.slot === "bottom" && item.value === "mm-skirt-navy",
);
const boy = defaultAvatarLook("boy"),
  girl = defaultAvatarLook("girl");
const boyItem = AVATAR_ITEMS.find((item) => item.id === "minimi-character-boy");
assert.equal(skirts.length, 1);
for (const skirt of skirts) {
  assert.equal(
    itemForLook({ ...boy, bottom: skirt.value }, "bottom"),
    undefined,
  );
  assert.equal(
    selectAvatarItem(boy, skirt),
    boy,
    "unsupported direct selection is ignored",
  );
  const female = selectAvatarItem(girl, skirt);
  assert.equal(female.bottom, skirt.value);
  assert.equal(
    selectAvatarItem(female, boyItem).bottom,
    boy.bottom,
    "character switch restores free shorts",
  );
  const restored = restoreAvatarLook({ ...boy, bottom: skirt.value });
  assert.equal(restored.bottom, boy.bottom);
  assert.equal(restored.character, "boy");
  assert.equal(restored.top, boy.top);
  assert.equal(
    restoreAvatarLook(female).bottom,
    skirt.value,
    "female selection survives restore",
  );
}
const retired = restoreAvatarState({
  schemaVersion: 1, catalogVersion: 1, look: { ...boy, hairStyle: "curtain" },
  revision: 17, lookHash: "retired", ownedItemIds: ["top:summer-white"],
  thumbnailUrl: "https://example.invalid/old-avatar.webp", requiresThumbnailRefresh: true,
});
assert.deepEqual(retired.look, defaultAvatarLook());
assert.equal(retired.catalogVersion, AVATAR_CATALOG_VERSION);
assert.equal(retired.revision, 17);
assert.equal(retired.ownedItemIds.length, 0);
assert.equal(retired.thumbnailUrl, undefined);
assert.equal(retired.requiresThumbnailRefresh, undefined);
console.log(
  "PASS minimi clothing: skirt restriction, character switch, saved choices and complete retired-catalog reset.",
);
