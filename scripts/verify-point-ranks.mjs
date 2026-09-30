import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const loadSource = async (relativePath) => {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    write: false,
  });
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputFiles[0].text, {
    module,
    exports: module.exports,
    require,
  });
  return module.exports;
};

const [ranks, { default: RankThemePreviewPanel }] = await Promise.all([
  loadSource("../src/lib/pointRanks.ts"),
  loadSource(
    "../src/pages/teacher/components/points/RankThemePreviewPanel.tsx",
  ),
]);

const joseonTiers = [
  { code: "tier_8", minPoints: 200, label: "노비" },
  { code: "tier_1", minPoints: 3000, label: "상민" },
  { code: "tier_3", minPoints: 5000, label: "중인" },
  { code: "tier_4", minPoints: 7000, label: "양반" },
  { code: "tier_5", minPoints: 10000, label: "왕족" },
];
const joseonPolicy = {
  enabled: true,
  activeThemeId: "korean_golpum",
  basedOn: "earnedTotal_plus_positive_manual_adjust",
  tiers: joseonTiers.map(({ code, minPoints }) => ({ code, minPoints })),
  themes: {
    korean_golpum: {
      themeName: "조선시대 신분제",
      tiers: Object.fromEntries(
        joseonTiers.map(({ code, label }) => [
          code,
          { label, shortLabel: label, description: label },
        ]),
      ),
    },
  },
};

const display = (rankPolicy, value, wallet = {}) =>
  ranks.getPointRankDisplay({
    rankPolicy,
    wallet: { earnedTotal: value, rankEarnedTotal: value, ...wallet },
  });

test("below the minimum, the current rank remains lowest and targets the next rank", () => {
  for (const value of [0, 199, 200]) {
    const rank = display(joseonPolicy, value);
    assert.equal(rank.label, "노비");
    assert.equal(rank.shortLabel, "노비");
    assert.equal(rank.minPoints, 200);
    assert.equal(rank.nextLabel, "상민");
    assert.equal(rank.nextMinPoints, 3000);
    assert.equal(rank.remainingToNext, 3000 - value);
    assert.equal(rank.progressPercent, 0);
    assert.equal(rank.metricValue, value);
  }
});

test("Joseon promotion boundaries and retired boundaries keep the expected rank", () => {
  const values = [
    0, 199, 200, 201, 999, 1000, 1999, 2000, 2999, 3000, 3001, 3999, 4000, 4999,
    5000, 5001, 6999, 7000, 7001, 9999, 10000, 10001,
  ];
  for (const value of values) {
    let index = 0;
    joseonTiers.forEach((tier, position) => {
      if (value >= tier.minPoints) index = position;
    });
    const current = joseonTiers[index];
    const next = joseonTiers[index + 1];
    const rank = display(joseonPolicy, value);
    assert.equal(rank.label, current.label);
    assert.equal(rank.shortLabel, current.label);
    assert.equal(rank.themeName, "조선시대 신분제");
    assert.equal(rank.nextLabel, next?.label || null);
    assert.equal(rank.nextMinPoints, next?.minPoints ?? null);
    assert.equal(rank.remainingToNext, next ? next.minPoints - value : 0);
    assert.doesNotMatch(
      [rank.themeName, rank.label, rank.description, rank.nextLabel].join(" "),
      /골품|두품|성골|진골|무등급/,
    );
  }
});

test("highest and single-tier policies do not invent a next rank", () => {
  for (const value of [10000, 10001, 20000]) {
    const rank = display(joseonPolicy, value);
    assert.equal(rank.label, "왕족");
    assert.equal(rank.nextLabel, null);
    assert.equal(rank.nextMinPoints, null);
    assert.equal(rank.remainingToNext, 0);
    assert.equal(rank.progressPercent, 100);
  }
  const onlyTier = { ...joseonPolicy, tiers: [joseonPolicy.tiers[0]] };
  for (const value of [0, 199, 200, 10000]) {
    const rank = display(onlyTier, value);
    assert.equal(rank.label, "노비");
    assert.equal(rank.nextLabel, null);
    assert.equal(rank.remainingToNext, 0);
    assert.equal(rank.progressPercent, 100);
  }
});

test("world theme and custom nonsequential tiers target the next sorted threshold", () => {
  const custom = {
    activeThemeId: "world_nobility",
    tiers: [
      { code: "tier_9", minPoints: 500 },
      { code: "tier_6", minPoints: 100 },
      { code: "tier_12", minPoints: 900 },
    ],
    themes: {
      world_nobility: {
        themeName: "맞춤 작위",
        tiers: {
          tier_6: { label: "수습", shortLabel: "수습" },
          tier_9: { label: "기사", shortLabel: "기사" },
          tier_12: { label: "대공", shortLabel: "대공" },
        },
      },
    },
  };
  for (const [value, label, nextLabel, nextMinPoints] of [
    [0, "수습", "기사", 500],
    [99, "수습", "기사", 500],
    [100, "수습", "기사", 500],
    [499, "수습", "기사", 500],
    [500, "기사", "대공", 900],
    [899, "기사", "대공", 900],
    [900, "대공", null, null],
  ]) {
    const rank = display(custom, value);
    assert.equal(rank.themeName, "맞춤 작위");
    assert.equal(rank.label, label);
    assert.equal(rank.nextLabel, nextLabel);
    assert.equal(rank.nextMinPoints, nextMinPoints);
  }
  assert.equal(display({ activeThemeId: "world_nobility" }, 0).label, "남작");
  assert.equal(display({ activeThemeId: "world_nobility" }, 50).label, "자작");
  assert.equal(display({ activeThemeId: "world_nobility" }, 500).label, "공작");
});

test("empty policy fallback and disabled policies preserve their behavior", () => {
  for (const policy of [undefined, null, {}, { tiers: [] }]) {
    const first = display(policy, 0);
    assert.equal(first.label, "4두품");
    assert.equal(first.nextLabel, "5두품");
    assert.equal(first.nextMinPoints, 50);
    assert.equal(display(policy, 50).label, "5두품");
    assert.equal(display(policy, 500).label, "성골");
    assert.equal(display(policy, 500).nextLabel, null);
  }
  assert.equal(display({ ...joseonPolicy, enabled: false }, 0), null);
});

test("legacy wallet and transaction metrics remain intact and inputs are not mutated", () => {
  for (const value of [0, 199, 200, 3000]) {
    const rank = display(joseonPolicy, value, { rankEarnedTotal: undefined });
    assert.equal(rank.label, value < 3000 ? "노비" : "상민");
    assert.equal(rank.metricValue, value);
    assert.equal(rank.nextMinPoints, value < 3000 ? 3000 : 5000);
  }
  const originalPolicy = JSON.stringify(joseonPolicy);
  const wallet = { earnedTotal: 2999 };
  const originalWallet = JSON.stringify(wallet);
  const rank = ranks.getPointRankDisplay({
    rankPolicy: joseonPolicy,
    wallet,
    earnedPointsFromTransactions: 1,
  });
  assert.equal(rank.metricValue, 3000);
  assert.equal(rank.label, "상민");
  assert.equal(JSON.stringify(wallet), originalWallet);
  assert.equal(JSON.stringify(joseonPolicy), originalPolicy);
  assert.equal(
    ranks.getPointRankDisplay({ rankPolicy: joseonPolicy }).label,
    "노비",
  );
});

test("the teacher selector uses a neutral history label while preserving custom theme display", () => {
  const render = (policy) => {
    const resolved = ranks.resolvePointRankPolicy(policy);
    return renderToStaticMarkup(
      React.createElement(RankThemePreviewPanel, {
        canManage: true,
        draftRankPolicy: resolved,
        activeThemeName: ranks.getPointRankThemeName(
          resolved,
          resolved.activeThemeId,
        ),
        previewThemeId: "world_nobility",
        previewThemeName: ranks.getPointRankThemeName(
          resolved,
          "world_nobility",
        ),
        enabledEmojiCount: 43,
        hasUnsavedChanges: false,
        saveFeedbackMessage: "",
        saveFeedbackTone: null,
        onThemeChange() {},
        onSave() {},
        getTierPreview: (tier, themeId = resolved.activeThemeId) =>
          ranks.getPointRankDisplayByTierCode({
            rankPolicy: resolved,
            tierCode: tier.code,
            themeId,
          }),
      }),
    );
  };
  const html = render(joseonPolicy);
  assert.match(
    html,
    /<option[^>]*value="korean_golpum"[^>]*>한국사 신분제<\/option>/,
  );
  assert.match(
    html,
    /<option[^>]*value="world_nobility"[^>]*>세계사 귀족제<\/option>/,
  );
  assert.doesNotMatch(html, /한국사 골품제/);
  for (const tier of joseonTiers)
    assert.match(html, new RegExp(`조선시대 신분제 ${tier.label}`));
  assert.match(
    render({
      ...joseonPolicy,
      themes: {
        korean_golpum: {
          ...joseonPolicy.themes.korean_golpum,
          themeName: "맞춤 신분제",
        },
      },
    }),
    /맞춤 신분제 노비/,
  );
});
