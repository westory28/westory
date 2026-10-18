import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const map = JSON.parse(
  readFileSync("src/data/atlas/countries-world.json", "utf8"),
);
const bytes = readFileSync("src/data/atlas/country-profiles.json");
const data = JSON.parse(bytes);
assert.equal(data.schemaVersion, 1);
assert.equal(data.license, "CC BY-SA 4.0");
assert(bytes.length < 1.8 * 1024 * 1024, "Bound profile transfer size");
assert(gzipSync(bytes).length < 300 * 1024, "Bound compressed profile cost");
const expected = new Map(
  map.countries.features.map(({ properties }) => [
    properties.id,
    properties.name,
  ]),
);
const profiles = new Map(data.profiles.map((profile) => [profile.id, profile]));
assert.equal(profiles.size, data.profiles.length, "Unique country profile IDs");
assert.deepEqual(
  [...profiles.keys()].sort(),
  [...expected.keys()].sort(),
  "Every selectable country/territory has an offline profile",
);
for (const [id, profile] of profiles) {
  assert.equal(profile.name, expected.get(id));
  assert(
    profile.overview.length > 15 && /[.!?]$/u.test(profile.overview),
    `${id}: complete overview sentence`,
  );
  assert(
    Array.isArray(profile.history) && profile.history.length > 0,
    `${id}: history supplied`,
  );
  assert(Array.isArray(profile.relations));
  assert.equal(
    new Set(profile.history).size,
    profile.history.length,
    `${id}: duplicate history`,
  );
  assert.equal(
    new Set(profile.relations).size,
    profile.relations.length,
    `${id}: duplicate relationship text`,
  );
  assert(profile.sources.length > 0, `${id}: source attribution`);
  for (const text of [
    profile.overview,
    ...profile.history,
    ...profile.relations,
  ]) {
    assert(
      text.trim() === text && !text.includes("==") && !/<\/?[a-z]/iu.test(text),
      `${id}: plain reading text`,
    );
  }
  if (id === "KOR") {
    assert.equal(profile.relationshipStatus, "domestic");
    assert.equal(
      profile.sources[0].title,
      "대한민국",
      "Map display convention must not change source subject",
    );
    assert.equal(profile.relations.length, 0);
  } else {
    assert.equal(
      profile.relationshipStatus,
      profile.relations.length ? "documented" : "not-found",
    );
  }
  for (const source of profile.sources) {
    assert.match(
      source.url,
      /^https:\/\/(ko|en)\.wikipedia\.org\/w\/index\.php\?oldid=\d+$/u,
    );
    assert(source.url.endsWith(String(source.revisionId)));
    assert(Number.isInteger(source.revisionId) && source.revisionId > 0);
    assert.equal(
      source.author,
      `${source.url.startsWith("https://en.") ? "영어" : "한국어"} 위키백과 기여자`,
    );
    assert.equal(source.license, "CC BY-SA 4.0");
    assert.equal(
      source.licenseUrl,
      "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
    );
    assert.match(
      source.historyUrl,
      /^https:\/\/(ko|en)\.wikipedia\.org\/w\/index\.php\?title=/u,
    );
    assert.match(source.sourceSha256, /^[a-f0-9]{64}$/u);
    assert(
      Number.isFinite(Date.parse(source.retrievedAt)) &&
        Number.isFinite(Date.parse(source.revisedAt)),
    );
    assert(source.changes.length > 10);
  }
}

// Source-cache verification is available during refresh/review; a clean build
// uses the committed revision-identified snapshot without network access.
const cacheDir = "output/atlas-country-sources";
if (existsSync(cacheDir)) {
  const revisions = new Map(
    readdirSync(cacheDir)
      .map((file) => JSON.parse(readFileSync(`${cacheDir}/${file}`, "utf8")))
      .filter((page) => page.extract && page.revisions?.[0]?.revid)
      .map((page) => [
        `${page.language || "ko"}:${page.revisions[0].revid}`,
        page,
      ]),
  );
  const normalize = (text) => {
    let normalized = text;
    for (let depth = 0; depth < 8; depth++)
      normalized = normalized.replace(/\([^()]*\)/gu, "");
    return normalized
      .replace(/\[[^\]]*\]/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
  };
  let checked = 0;
  for (const profile of data.profiles) {
    const sourcePages = profile.sources.map((source) =>
      revisions.get(
        `${source.url.startsWith("https://en.") ? "en" : "ko"}:${source.revisionId}`,
      ),
    );
    if (sourcePages.some((source) => !source)) continue;
    profile.sources.forEach((source, index) =>
      assert.equal(
        createHash("sha256").update(sourcePages[index].extract).digest("hex"),
        source.sourceSha256,
        `${profile.id}: unchanged source snapshot`,
      ),
    );
    const sourceText = sourcePages.map((page) => normalize(page.extract));
    for (const sentence of [
      profile.overview,
      ...profile.history,
      ...profile.relations,
    ]) {
      const original =
        profile.editorialChanges?.find((change) => change.text === sentence)
          ?.sourceText || sentence;
      assert(
        sourceText.some((text) => text.includes(normalize(original))),
        `${profile.id}: every displayed sentence comes from an attributed revision`,
      );
    }
    checked++;
  }
  console.log(`Source-cache provenance checked for ${checked} profiles.`);
}
console.log(
  `Country profiles verified: ${profiles.size} complete profiles, ${data.profiles.filter((profile) => profile.relationshipStatus === "documented").length} documented Republic of Korea relationships.`,
);
