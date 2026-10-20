import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { format } from "prettier";

const cache = new Map();
const checkOnly = process.argv.includes("--check");
function saveGenerated(path, content) {
  if (checkOnly)
    assert.equal(
      readFileSync(path, "utf8").replace(/\r\n/g, "\n"),
      content,
      `Generated classification is stale: ${path}`,
    );
  else writeFileSync(path, content);
}
function load(filename) {
  const path = resolve(filename);
  if (cache.has(path)) return cache.get(path);
  const exports = {};
  cache.set(path, exports);
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    { exports, require: (name) => load(resolve(dirname(path), `${name}.ts`)) },
  );
  return exports;
}

const { historyAtlasSourceDataset: source, historyAtlasDataset: displayed } =
  load("src/data/historyAtlasContent.ts");
const { getAtlasHistoryEntries } = load("src/lib/historyAtlasStories.ts");
const { getAtlasPlaceRegionIds } = load("src/lib/historyAtlasRegions.ts");
const { historyAtlasReferenceDefinitions } = load(
  "src/data/historyAtlasReferenceDefinitions.ts",
);
const { historyDictionaryPlaceRows } = load(
  "src/data/historyDictionaryPlaces.ts",
);
const { historyDictionaryCoreRows } = load("src/data/historyDictionaryCore.ts");
const { expandHistoryDictionaryFacetIds, historyDictionaryFacets } = load(
  "src/lib/historyDictionaryThemes.ts",
);
const facetById = new Map(
  historyDictionaryFacets.map((item) => [item.id, item]),
);
const placeById = new Map(
  [...source.places, ...displayed.places].map((place) => [place.id, place]),
);
const unitById = new Map(source.units.map((unit) => [unit.id, unit]));
const entriesByPlace = new Map();
for (const entry of source.entries) {
  if (!entriesByPlace.has(entry.placeId)) entriesByPlace.set(entry.placeId, []);
  entriesByPlace.get(entry.placeId).push(entry);
}

// Deliberately manual: original core tags are worksheet chapters, not periods.
const coreEras = new Map();
function eras(words, ids) {
  for (const word of words.split("|")) {
    assert(!coreEras.has(word), `Duplicate core era decision: ${word}`);
    coreEras.set(
      word,
      ids.map((id) => `era:${id}`),
    );
  }
}
eras("고조선", ["k-gojoseon"]);
eras("고려", ["k-later-three", "k-goryeo"]);
eras("조선", ["k-joseon-early", "k-joseon-late", "k-opening"]);
eras("위화도 회군|정몽주", ["k-goryeo"]);
eras("과전법|이성계|정도전|집현전", ["k-goryeo", "k-joseon-early"]);
eras("사헌부|춘추관|성균관", [
  "k-goryeo",
  "k-joseon-early",
  "k-joseon-late",
  "k-opening",
]);
eras("호패법", ["k-goryeo", "k-joseon-early", "k-joseon-late"]);
eras(
  "성리학|사대부|유교|불교|왕조|왕도 정치|재상|사병|수조권|문관|관혼상제|족보|사당|활자|군역|의병|유격전|제해권|여진|공신|외척",
  ["common"],
);
eras("육조|의정부|경연|홍문관|경국대전|정승|병조|삼사|사간원|승정원", [
  "k-joseon-early",
  "k-joseon-late",
  "k-opening",
]);
eras(
  "의정부 서사제|사림|향약|서원|사액서원|과실상규|환난상휼|산림|붕당|서인|남인|이조 전랑",
  ["k-joseon-early", "k-joseon-late"],
);
eras("소학|가례", ["w-medieval", "k-joseon-early", "k-joseon-late"]);
eras("백자", ["k-goryeo", "k-joseon-early", "k-joseon-late"]);
eras(
  "태종|세조|성종|직전법|육조 직계제|삼강행실도|훈민정음|국조오례의|고려사|정철|금오신화|농사직설|세종|몽유도원도|천상열차분야지도|분청사기|갑인자|신기전|안견|앙부일구|화차|임진왜란|유정|신립|권율|정명가도|곽재우|이순신|김시민|정유재란|옥포 해전|한산도 대첩|명량 해전|노량 해전|진주대첩|행주대첩|훈구|사화|김종직|조광조|무오사화|갑자사화|기묘사화|을사사화|소격서|현량과|조의제문|위훈 삭제|백운동 서원|해주향약|동인",
  ["k-joseon-early"],
);
eras("도요토미 히데요시", ["k-joseon-early", "w-early-modern"]);
eras("도쿠가와 이에야스", ["w-early-modern"]);
eras(
  "광해군|중립 외교|강홍립|사르후 전투|폐모살제|영창대군|인목대비|인조반정|인조|친명배금|척화론|주화론|정묘호란|병자호란|이괄|소현세자|효종|북벌론|대북",
  ["k-joseon-late"],
);
eras("후금|누르하치", ["k-joseon-late", "w-early-modern"]);

const coreTopics = new Map();
function topics(words, ids) {
  for (const word of words.split("|"))
    coreTopics.set(word, [
      ...new Set([
        ...(coreTopics.get(word) || []),
        ...ids.map((id) => `topic:${id}`),
      ]),
    ]);
}
topics("조선|고려|고조선|왕조|후금", ["country"]);
topics("과전법|직전법|수조권", ["land-tax"]);
topics(
  "위화도 회군|인조반정|사화|무오사화|갑자사화|기묘사화|을사사화|폐모살제|이괄|위훈 삭제",
  ["political-events"],
);
topics(
  "이성계|태종|세조|성종|세종|광해군|인조|효종|누르하치|도쿠가와 이에야스|도요토미 히데요시",
  ["rulers"],
);
topics("정도전|정몽주|정철|김종직|조광조|소현세자", ["scholars"]);
topics("영창대군|인목대비", ["people"]);
topics(
  "성리학|유교|왕도 정치|소학|가례|사림|향약|서원|사액서원|백운동 서원|과실상규|환난상휼|해주향약|산림",
  ["confucianism"],
);
topics("불교|유정", ["buddhism"]);
topics("사대부|문관|공신|외척|여진", ["social-order"]);
topics(
  "재상|육조|의정부|집현전|홍문관|정승|병조|삼사|사헌부|사간원|승정원|춘추관|이조 전랑|소격서",
  ["government"],
);
topics("호패법|경연|경국대전|육조 직계제|의정부 서사제|현량과", ["law"]);
topics("성균관|집현전|경연|소학|서원|사액서원|백운동 서원|산림", ["education"]);
topics("삼강행실도|국조오례의|관혼상제|가례|족보|사당|과실상규|환난상휼", [
  "rites",
]);
topics("삼강행실도|고려사|정철|금오신화|조의제문|춘추관", ["literature"]);
topics("훈민정음|갑인자|활자", ["printing"]);
topics("농사직설|천상열차분야지도|신기전|앙부일구|화차", ["science"]);
topics("몽유도원도|분청사기|백자|안견", ["art"]);
topics("안견|정철", ["artists"]);
topics(
  "임진왜란|정유재란|옥포 해전|한산도 대첩|명량 해전|노량 해전|진주대첩|행주대첩|사르후 전투|정묘호란|병자호란",
  ["battles"],
);
topics("사병|신기전|화차|군역|의병|유격전|제해권", ["military"]);
topics("유정|신립|권율|곽재우|이순신|김시민|강홍립|이괄", ["generals"]);
topics("유정", ["religious-people"]);
topics("정명가도|중립 외교|친명배금|척화론|주화론|북벌론", ["diplomacy"]);
topics("훈구|사림|붕당|동인|서인|남인|대북", ["political-groups"]);

const worldCoreWords = new Set(
  "성리학|사대부|유교|불교|왕조|왕도 정치|재상|사병|수조권|문관|소학|가례|관혼상제|족보|사당|활자|군역|의병|유격전|제해권|여진|도요토미 히데요시|도쿠가와 이에야스|후금|누르하치|공신|외척".split(
    "|",
  ),
);

// Keep published palette indices stable when new reviewed places add themes.
// Every term is still reclassified from its sources below.
const { historyDictionaryFacetSets: previousFacetSets } = load(
  "src/data/historyDictionaryClassification.ts",
);
const facetSets = previousFacetSets.map((ids) => Array.from(ids));
const setIds = new Map(
  facetSets.map((ids, index) => [JSON.stringify(ids), index]),
);
function intern(ids) {
  const expanded = expandHistoryDictionaryFacetIds(ids);
  const key = JSON.stringify(expanded);
  if (!setIds.has(key)) {
    setIds.set(key, facetSets.length);
    facetSets.push(expanded);
  }
  return setIds.get(key);
}
const core = {};
for (const [word] of historyDictionaryCoreRows) {
  assert(coreEras.has(word), `Missing reviewed core era: ${word}`);
  assert(coreTopics.has(word), `Missing reviewed core topic: ${word}`);
  const subjects = [
    "subject:korea",
    ...(worldCoreWords.has(word) ? ["subject:world"] : []),
  ];
  core[word] = intern([
    ...subjects,
    ...coreEras.get(word),
    ...coreTopics.get(word),
  ]);
}
assert.equal(
  coreEras.size,
  historyDictionaryCoreRows.length,
  "Stale core era classification",
);
assert.equal(
  coreTopics.size,
  historyDictionaryCoreRows.length,
  "Stale core topic classification",
);

const referenceKeys = new Map(
  historyAtlasReferenceDefinitions.map(([id, title, revision]) => [
    id,
    `${title}\u0000${revision}`,
  ]),
);
const peersByReference = new Map();
const dictionaryWordById = new Map(
  historyDictionaryPlaceRows.map(([id, word]) => [
    id,
    word.normalize("NFKC").replace(/\s+/gu, ""),
  ]),
);
for (const [id] of historyDictionaryPlaceRows) {
  const key = referenceKeys.get(id);
  if (!key) continue;
  if (!peersByReference.has(key)) peersByReference.set(key, []);
  peersByReference.get(key).push(id);
}
const reviewedRegions = (id) => {
  const place = placeById.get(id);
  const korea = getAtlasPlaceRegionIds(place, "korea")
    .filter((region) => !["outside-korea", "unclassified"].includes(region))
    .map((region) => `region:korea-${region}`);
  const world = getAtlasPlaceRegionIds(place, "world")
    .filter((region) => region !== "unclassified")
    .map((region) => `region:${region}`);
  return [...new Set([...korea, ...world])];
};

// These corrections are entity-specific and supported by the displayed definition,
// rather than broad textbook chapter tags. Never merge merely by place.name.
const eraOverrides = {
  "kr-e9c99a172d2b": [
    "k-three-kingdoms",
    "k-unified-silla",
    "k-north-south",
    "k-later-three",
  ],
  "world-e9c99a172d2b": [
    "k-three-kingdoms",
    "k-unified-silla",
    "k-north-south",
    "k-later-three",
  ],
  "world-5350ddf46cbb": ["w-medieval"],
};
const historicalCountries = new Set(
  "고조선|고구려|백제|신라|고려|조선|북위|동위|서위|북제|북주|수(중국)|당|송|북송|남송|부여(나라)|발해|후금|청|명|금(중국)|요|원|한(중국)|동진|후연|전연|왜|동부여".split(
    "|",
  ),
);
const ethnicGroupIds = new Set([
  "kr-06811683f45c",
  "kr-2ffc31b9b5e6",
  "kr-d95ad83c4fe7",
  "kr-e4a602fa8857",
]);
const classification = {};
const unassignedEras = [];
const unconfirmedRegions = [];
const copiedRegions = [];
const copiedEras = [];
const placeDecisions = [];
let directEraCount = 0;
let directRegionCount = 0;
for (const [id, word, definition] of historyDictionaryPlaceRows) {
  const place = placeById.get(id);
  assert(place, `Unknown dictionary place: ${id}`);
  const entries = entriesByPlace.get(id) || [];
  const subjects = new Set(
    entries
      .map((entry) => unitById.get(entry.unitId)?.subject)
      .filter(Boolean)
      .map((subject) => `subject:${subject}`),
  );
  assert(subjects.size, `Missing source field: ${id}`);
  const histories = getAtlasHistoryEntries(source, id);
  let eras = [...new Set(histories.flatMap((entry) => entry.eraIds || []))];
  if (eras.length) directEraCount++;
  if (eraOverrides[id]) eras = eraOverrides[id];
  // A single article can describe several entities (four counties/six garrisons,
  // nine Seon schools). Require both the same name and the same source revision.
  const peers = (peersByReference.get(referenceKeys.get(id)) || []).filter(
    (peer) =>
      peer !== id &&
      dictionaryWordById.get(peer) === dictionaryWordById.get(id),
  );
  if (!eras.length && peers.length) {
    const evidencedPeers = peers.filter(
      (peer) => getAtlasHistoryEntries(source, peer).length,
    );
    eras = [
      ...new Set(
        evidencedPeers.flatMap(
          (peer) =>
            eraOverrides[peer] ||
            getAtlasHistoryEntries(source, peer).flatMap(
              (entry) => entry.eraIds || [],
            ),
        ),
      ),
    ];
    if (eras.length)
      copiedEras.push({
        id,
        word,
        from: evidencedPeers,
        source: referenceKeys.get(id).replace("\u0000", " · oldid="),
      });
  }
  if (!eras.length)
    unassignedEras.push({
      id,
      word,
      reason:
        "지리 개요만 있거나 지도 캡션·자료 소장처 맥락뿐이어서 뜻풀이에 연결할 역사 시대 근거가 없음",
    });
  // Era subjects supplement the original curriculum field; Korea records used
  // in world history retain both fields, rather than being moved out of one.
  for (const era of eras) {
    const subject = facetById.get(`era:${era}`)?.subjectId;
    if (subject) subjects.add(subject);
  }
  let regions = reviewedRegions(id);
  if (regions.length) directRegionCount++;
  if (peers.length) {
    const peerRegions = peers.flatMap(reviewedRegions);
    const added = peerRegions.filter((region) => !regions.includes(region));
    if (added.length)
      copiedRegions.push({
        id,
        word,
        from: peers.filter((peer) =>
          reviewedRegions(peer).some((region) => added.includes(region)),
        ),
        source: referenceKeys.get(id).replace("\u0000", " · oldid="),
        added: [...new Set(added)],
      });
    regions = [...new Set([...regions, ...peerRegions])];
  }
  if (!regions.length) {
    regions = ["region:unconfirmed"];
    unconfirmedRegions.push({
      id,
      word,
      reason:
        "검증된 지도 지역표 또는 동일 위키백과 문서 개정판의 지역 연결 없음",
    });
  }
  const topics = new Set(["topic:geography"]);
  const country =
    historicalCountries.has(word) ||
    (/(?:제국|왕국|공국|공화국|왕조)$/u.test(word) &&
      /(?:국가|나라|왕조|왕국|제국|공화국|공국)/u.test(definition));
  if (ethnicGroupIds.has(id)) topics.add("topic:social-order");
  else if (country) topics.add("topic:country");
  else if (place.kind) topics.add(`topic:${place.kind}`);
  // Map kinds describe display areas too. Require both the proper-name suffix
  // and an explicit definition before adding a more specific landform topic.
  if (/사막$/u.test(word) && /사막/u.test(definition))
    topics.add("topic:desert");
  if (/섬$/u.test(word) && /섬/u.test(definition)) topics.add("topic:island");
  if (/산맥$/u.test(word) && /산맥/u.test(definition))
    topics.add("topic:mountain");
  if (/(?:박물관|미술관|기념관)/u.test(word.replace(/\s+/gu, "")))
    topics.add("topic:museum");
  if (/(?:대학교|대학)$/u.test(word.replace(/\s+/gu, "")))
    topics.add("topic:education");
  classification[id] = intern([
    ...subjects,
    ...eras.map((era) => `era:${era}`),
    ...regions,
    ...topics,
  ]);
  if (eraOverrides[id])
    placeDecisions.push({
      id,
      word,
      eraIds: eraOverrides[id],
      reason:
        "사전 뜻풀이에 명시된 국가의 시대. 같은 이름의 다른 장소는 연결하지 않음",
    });
}

const output = `// Generated by scripts/build-history-dictionary-classification.mjs.\n// Compact, source-reviewed metadata only; no map geometry/runtime imports.\n// Missing place eras are intentional; see the classification audit.\nexport const historyDictionaryFacetSets: string[][] = ${JSON.stringify(facetSets)};\nexport const historyDictionaryCoreClassification: Record<string, number> = ${JSON.stringify(core)};\nexport const historyDictionaryPlaceClassification: Record<string, number> = ${JSON.stringify(classification)};\n`;
saveGenerated(
  "src/data/historyDictionaryClassification.ts",
  await format(output, { parser: "typescript" }),
);
const audit = {
  reviewedAt: "2026-10-18",
  geographicReferencesReviewedAt: "2026-10-20",
  total: historyDictionaryCoreRows.length + historyDictionaryPlaceRows.length,
  coreCount: historyDictionaryCoreRows.length,
  placeCount: historyDictionaryPlaceRows.length,
  facetCount: historyDictionaryFacets.length,
  facetSetCount: facetSets.length,
  directEraCount,
  classifiedPlaceEraCount:
    historyDictionaryPlaceRows.length - unassignedEras.length,
  directRegionCount,
  classifiedPlaceRegionCount:
    historyDictionaryPlaceRows.length - unconfirmedRegions.length,
  eraPolicy:
    "실제 역사 설명의 관련 시대만 사용. 지도 캡션·자료 소장처·단원 tags로 추정하지 않음. 성립 연대나 존속 기간 전체를 뜻하지 않음.",
  regionPolicy:
    "세계 지역은 기존 검증 지역표. 한반도 아래 조선 8도는 역사 탐색 권역이며 현대 행정구역이 아님. bbox/좌표/동명 자동추정 없음.",
  corePolicy:
    "133개 원문 기반 뜻풀이를 수동 검토. 일반 개념은 시대 공통, 고려사 등 저술은 서술 대상 대신 실제 편찬 시대. 지역은 장소 아닌 개념에 임의 지정하지 않음.",
  peerPolicy:
    "지명 정규화 이름과 출처 문서·개정 번호가 모두 같을 때만 지역·시대 근거를 공유. 하나의 문서가 다루는 별개 장소(4군/6진·구산선문 등)는 합치지 않음.",
  topicPolicy:
    "지도 kind를 기본으로 명시된 역사국가·민족 의미를 검토해 구분. 사막·섬·산맥은 이름 접미사와 뜻풀이가 모두 지형을 명시할 때만 추가.",
  placeDecisions,
  copiedEras,
  copiedRegions,
  unassignedEras,
  unconfirmedRegions,
};
saveGenerated(
  "docs/reviews/history-dictionary-classification-20261018.json",
  JSON.stringify(audit, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    total: audit.total,
    core: audit.coreCount,
    places: audit.placeCount,
    facets: audit.facetCount,
    sets: audit.facetSetCount,
    placeEras: audit.classifiedPlaceEraCount,
    placeRegions: audit.classifiedPlaceRegionCount,
    copiedEras: copiedEras.length,
    copiedRegions: copiedRegions.length,
  }),
);
