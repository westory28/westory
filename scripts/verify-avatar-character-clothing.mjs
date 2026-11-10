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
} = module.exports;
const skirts = AVATAR_ITEMS.filter(
  (item) => item.slot === "bottom" && /^(pleated|chima)-/.test(item.value),
);
const boy = defaultAvatarLook("boy"),
  girl = defaultAvatarLook("girl");
const boyItem = AVATAR_ITEMS.find((item) => item.id === "character:boy");
assert.equal(skirts.length, 7);
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
console.log(
  "PASS avatar clothing: 7 skirts are female-only; direct selection, character switch and saved-look restoration retain supported clothes.",
);
