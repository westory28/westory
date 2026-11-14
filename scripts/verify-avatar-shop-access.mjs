import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({
  stdin: {
    contents:
      'export * from "./src/lib/studentMenuAccess"; export * from "./src/constants/menus";',
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const policy = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const config = {
  year: "2026",
  semester: "2",
  showQuiz: true,
  showScore: true,
  showLesson: true,
};
const shop = { pathname: "/student/points", search: "?tab=shop&shop=avatar" };
const wardrobe = { pathname: "/student/mypage", search: "?menu=avatar" };
const blocked = [
  { url: "/student/points", hidden: true },
  ...[
    "/student/points?tab=shop",
    "/student/points?tab=shop&shop=avatar",
    "/student/points?shop=avatar&tab=shop",
    "/student/points/?shop=avatar&tab=shop&extra=fixture",
  ].map((url) => ({
    url: "/student/points",
    children: [{ name: "hidden", url, hidden: true }],
  })),
];
for (const hidden of blocked) {
  const menus = policy.cloneDefaultMenus();
  const points = menus.student.find((item) => item.url === "/student/points");
  if (hidden.hidden) points.hidden = true;
  else points.children.push(...hidden.children);
  assert.equal(policy.buildStudentMenuVisibility(menus).avatar_shop, false);
  assert.equal(policy.buildStudentMenuVisibility(menus).avatar, true);
  assert.equal(
    policy.getStudentRouteAccess(shop, config, menus).allowed,
    false,
  );
  assert.equal(
    policy.getStudentRouteAccess(wardrobe, config, menus).allowed,
    true,
  );
}
const menus = policy.cloneDefaultMenus();
assert.equal(policy.buildStudentMenuVisibility(menus).avatar_shop, true);
assert.equal(policy.getStudentRouteAccess(shop, config, menus).allowed, true);
assert.equal(
  policy.getStudentRouteAccess(
    shop,
    { ...config, studentMenuVisibility: { avatar_shop: false } },
    menus,
  ).allowed,
  false,
);
assert.equal(
  policy.getStudentRouteAccess(
    wardrobe,
    { ...config, studentMenuVisibility: { avatar_shop: false } },
    menus,
  ).allowed,
  true,
);
const alias = { ...wardrobe, search: "?menu=wardrobe" };
assert.equal(policy.getStudentRouteAccess(alias, config, menus).allowed, true);
for (const key of ["avatar", "mypage"]) {
  assert.equal(
    policy.getStudentRouteAccess(
      alias,
      { ...config, studentMenuVisibility: { [key]: false } },
      menus,
    ).allowed,
    false,
  );
}
const avatar = menus.student
  .find((item) => item.url === "/student/mypage")
  .children.find((item) => item.url === "/student/mypage?menu=avatar");
avatar.hidden = true;
assert.equal(policy.getStudentRouteAccess(alias, config, menus).allowed, false);
assert.equal(
  policy.buildStudentMenuVisibility({ student: [], teacher: [] }).avatar_shop,
  true,
);
console.log(
  "PASS avatar-shop projection, reordered queries, independent wardrobe and wardrobe alias access",
);
