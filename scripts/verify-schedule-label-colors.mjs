import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import ts from "typescript";

// Load the production helpers without initializing Firebase or subscribing.
const bundled = await build({
  entryPoints: ["src/lib/scheduleCategories.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["firebase/firestore", "./firebase", "react"],
  write: false,
  logLevel: "silent",
});
const require = createRequire(import.meta.url);
const firestore = {
  doc: () => assert.fail("Color helpers must not access Firestore"),
  onSnapshot: () =>
    assert.fail("Color helpers must not subscribe to Firestore"),
};
const loaded = { exports: {} };
new Function("module", "exports", "require", bundled.outputFiles[0].text)(
  loaded,
  loaded.exports,
  (id) => {
    if (id === "firebase/firestore") return firestore;
    if (id === "./firebase") return { db: {} };
    return require(id);
  },
);
const {
  CATEGORY_COLOR_PRESETS,
  DEFAULT_SCHEDULE_CATEGORIES,
  SCHEDULE_COLOR_NAMES,
  getScheduleEventColor,
  getScheduleEventTextColor,
  resolveScheduleCategories,
} = loaded.exports;

const luminance = (hex) => {
  const rgb = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort(
    (a, b) => a - b,
  );
  return (values[1] + 0.05) / (values[0] + 0.05);
};
const contrastResults = [];
const checkContrast = (event, categories, label) => {
  const background = getScheduleEventColor(event, categories);
  const foreground = getScheduleEventTextColor(event, categories);
  assert.match(foreground, /^#[0-9a-f]{6}$/i);
  const ratio = contrast(foreground, background);
  contrastResults.push({ label, foreground, background, ratio });
};

assert.equal(CATEGORY_COLOR_PRESETS.length, 9);
assert.equal(SCHEDULE_COLOR_NAMES.length, CATEGORY_COLOR_PRESETS.length);
for (const [index, preset] of CATEGORY_COLOR_PRESETS.entries()) {
  const event = { eventType: "exam", labelColor: preset.color };
  assert.equal(
    getScheduleEventColor(event),
    preset.color,
    "Explicit labels must override the category",
  );
  checkContrast(event, undefined, SCHEDULE_COLOR_NAMES[index]);
}

const custom = resolveScheduleCategories([
  {
    key: "field-trip",
    label: "현장체험",
    color: "#777777",
    emoji: "🔵",
    order: 9,
  },
  { key: "exam", label: "학교 시험", color: "#1268A0", emoji: "🔴", order: 0 },
]);
assert.equal(
  getScheduleEventColor({ eventType: "field-trip" }, custom),
  "#777777",
);
assert.equal(getScheduleEventColor({ eventType: "exam" }, custom), "#1268A0");
assert.equal(
  getScheduleEventColor(
    { eventType: "field-trip", labelColor: "  #ABCDEF  " },
    custom,
  ),
  "#ABCDEF",
);

for (const labelColor of [
  undefined,
  "",
  "   ",
  "red",
  "#fff",
  "#zzzzzz",
  "#11223344",
  "url(example)",
]) {
  const event = { eventType: "field-trip", labelColor };
  assert.equal(
    getScheduleEventColor(event, custom),
    "#777777",
    "Invalid labels must preserve the custom category color",
  );
  checkContrast(event, custom, `custom fallback ${String(labelColor)}`);
}
for (const category of DEFAULT_SCHEDULE_CATEGORIES) {
  assert.equal(
    getScheduleEventColor({ eventType: category.key }),
    category.color,
  );
  checkContrast(
    { eventType: category.key },
    undefined,
    `default ${category.key}`,
  );
}
assert.equal(getScheduleEventColor(undefined), "#6b7280");
assert.equal(getScheduleEventColor({ eventType: "missing" }), "#6b7280");
checkContrast(undefined, undefined, "missing event");
checkContrast(
  { eventType: "exam" },
  custom,
  "custom default category override",
);
for (const labelColor of [
  "#000000",
  "#ffffff",
  "#777777",
  "#808080",
  "#ABCDEF",
]) {
  checkContrast(
    { eventType: "exam", labelColor },
    undefined,
    `custom ${labelColor}`,
  );
}

// The teacher month view applies a light tint separately. Stored label colors
// and these shared helpers must keep the raw colors used by other views.
for (const preset of CATEGORY_COLOR_PRESETS) {
  const tint = `#${[1, 3, 5]
    .map((offset) =>
      Math.round(
        Number.parseInt(preset.color.slice(offset, offset + 2), 16) * 0.22 +
          255 * 0.78,
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
  assert.ok(
    contrast("#111827", tint) >= 4.5,
    `Teacher tinted ${preset.color} must remain readable`,
  );
}
const failures = contrastResults.filter(({ ratio }) => ratio < 4.5);
assert.equal(
  failures.length,
  0,
  `Normal-sized label text requires 4.5:1 contrast:\n${failures
    .map(
      ({ label, foreground, background, ratio }) =>
        `${label}: ${foreground} on ${background} = ${ratio.toFixed(3)}:1`,
    )
    .join("\n")}`,
);

// A correct helper is insufficient when a badge only wires its background.
// Require the real solid-color badges to select contrasting text in the same
// style object, while retaining their existing holiday treatment.
const badgeFiles = [
  "src/components/common/ScheduleEventDetailModal.tsx",
  "src/components/common/ScheduleMorePopover.tsx",
  "src/pages/student/components/SearchModal.tsx",
];
for (const file of badgeFiles) {
  const source = ts.createSourceFile(
    file,
    await readFile(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let connectedBadge = false;
  const inspect = (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === "style") {
      const style = node.initializer?.expression;
      if (style && ts.isObjectLiteralExpression(style)) {
        const properties = style.properties.filter(ts.isPropertyAssignment);
        const background = properties.find(
          (property) => property.name.getText(source) === "backgroundColor",
        );
        const color = properties.find(
          (property) => property.name.getText(source) === "color",
        );
        if (background && color) {
          const containsContrast = (value) => {
            if (
              ts.isCallExpression(value) &&
              value.expression.getText(source) === "getScheduleEventTextColor"
            )
              return true;
            return Boolean(ts.forEachChild(value, containsContrast));
          };
          connectedBadge ||= containsContrast(color.initializer);
        }
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
  assert.ok(connectedBadge, `${file}: solid badge must apply contrast text`);
}
console.log(
  `Schedule label color checks passed (9 presets, category fallback, ${contrastResults.length} raw contrast cases, teacher tints, ${badgeFiles.length} solid badge connections).`,
);
