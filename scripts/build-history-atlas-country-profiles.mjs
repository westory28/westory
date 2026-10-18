/**
 * Rebuild the self-hosted country reading layer from openly licensed Wikipedia.
 * Country IDs/names come from the existing map, never from geocoding.
 * No machine-written diplomatic facts: missing material stays explicitly absent.
 * Run with --refresh to fetch new source revisions; otherwise cached responses
 * in output/atlas-country-sources keep editorial review reproducible.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(root, "output/atlas-country-sources");
await mkdir(cacheDir, { recursive: true });
const countries = JSON.parse(
  await readFile(
    path.join(root, "src/data/atlas/countries-world.json"),
    "utf8",
  ),
).countries.features;
const refresh = process.argv.includes("--refresh");
const titles = {
  SJM: "얀마옌섬",
  HMD: "허드 맥도널드 제도",
  ATF: "프랑스령 남방 및 남극 지역",
  TUR: "튀르키예",
};
// Reviewed sentence starts select representative events from the same source
// revision, without introducing uncited summaries or accidental topic drift.
const historySelections = {
  KOR: [
    "대한민국은 1948년 5월 10일",
    "대한민국은 20세기 후반 이후",
    "현행 헌법은 1987년 6월 항쟁",
  ],
  USA: [
    "13개 식민지는 1775년",
    "조세권을 가진 강력한 국가를",
    "제2차 세계 대전 이후 냉전기에",
  ],
  CHN: [
    "1949년 10월 1일 베이징의",
    "화궈펑 이후에는 덩샤오핑이",
    "1978년부터 시작된 경제개혁 이후부터",
  ],
  FRA: ["국민의회의 대표들은 국왕이", "20세기 후반과 21세기 초반, 프랑스는"],
  RUS: [
    "러일 전쟁의 패배로",
    "1917년 11월, 블라디미르 레닌이",
    "러시아 연방의 국명 변경은",
  ],
  JPN: [
    "1868년 이후 일본은",
    "메이지 시대 이후부터 일본에서는",
    "또, 국가 제도의 개혁이",
  ],
  DEU: [
    "프로이센-프랑스 전쟁에서",
    "1939년 9월 1일 독일이",
    "동독에서 공산주의 정부가 몰락한",
  ],
  GBR: [
    "1707년에 잉글랜드 왕국과",
    "한편 북아메리카에 설립한",
    "그러던 중 히틀러 주도의",
  ],
  AUS: ["1901년 1월 1일, 여섯 개", "제2차 세계 대전 이후 오스트레일리아는"],
  MAF: ["2007년 2월 22일 세인트마틴 섬의"],
};
const overviewEdits = {
  BEL: "벨기에 왕국은 서유럽에 있는 입헌 군주국이다.",
  SWE: "스웨덴 왕국은 북유럽 스칸디나비아 반도의 동반부를 차지하는 입헌 군주국이다.",
  COG: "콩고 공화국은 아프리카 콩고강 유역에 접한 나라이다.",
  BLM: "생바르텔레미는 서인도 제도에 위치한 프랑스의 해외 집합체이다.",
  SJM: "얀마옌섬은 북극에 있는 노르웨이의 섬이다.",
};
const relationSelections = {
  USA: ["1882년(고종 19년)", "한국 전쟁(1950년~1953년) 당시"],
  JPN: [
    "1965년에 한일기본조약",
    "이러한 야당과 국민들의 반발이",
    "1998년 11월 18일에는",
  ],
  CHN: ["대한민국과 중화인민공화국은 1989년", "1992년 8월부터 노태우 정부의"],
  RUS: ["한국전쟁에 소련이", "러시아인들은 1990년대부터"],
  FRA: ["프랑스는 지난날 천주교 신부를", "1950년 한국 전쟁 때는"],
  SWE: ["대한민국과 스웨덴은 1959년", "스웨덴은 6.25 전쟁 이후에도"],
  TZA: [
    "대한민국과 탄자니아는 두 나라는",
    "이후 탄자니아는 2018년에",
    "2024년 5월, 탄자니아의",
  ],
};
let nextRequestAt = 0;

async function queryArticle(title, language = "ko") {
  const file = path.join(
    cacheDir,
    `${createHash("sha256")
      .update(language === "ko" ? title : `${language}:${title}`)
      .digest("hex")}.json`,
  );
  if (!refresh) {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      /* fetch once */
    }
  }
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    redirects: "1",
    prop: "extracts|revisions",
    exlimit: "1",
    explaintext: "1",
    rvprop: "ids|timestamp",
    titles: title,
  });
  let response;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const requestAt = Math.max(Date.now(), nextRequestAt);
      nextRequestAt = requestAt + 800;
      await new Promise((resolve) =>
        setTimeout(resolve, requestAt - Date.now()),
      );
      const fetched = await fetch(
        `https://${language}.wikipedia.org/w/api.php?${params}`,
        {
          headers: {
            "User-Agent":
              "WestoryAtlas/1.0 (educational open-content snapshot; https://www.westory.kr)",
          },
          signal: AbortSignal.timeout(30000),
        },
      );
      if (fetched.status === 429) nextRequestAt = Date.now() + 30000;
      if (!fetched.ok) throw new Error(`HTTP ${fetched.status}`);
      response = await fetched.json();
      if (response.error) throw new Error(response.error.info);
      break;
    } catch (error) {
      if (attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)));
    }
  }
  const page = response.query?.pages?.[0];
  if (!page) throw new Error(`No page response: ${title}`);
  const result = { ...page, language, retrievedAt: new Date().toISOString() };
  await writeFile(file, JSON.stringify(result));
  return result;
}

// Preserve article wording and dates; remove only pronunciation/foreign-name
// parentheses, reference markers and presentation whitespace.
function clean(text) {
  let value = text;
  for (let depth = 0; depth < 8; depth++)
    value = value.replace(/\([^()]*\)/gu, (parenthetical) =>
      !/\d{3,4}년/u.test(parenthetical) &&
      /[가-힣]+어:|중국어|한자:|로마자:|발음:|문화어:|^\([A-Za-z]|^\([^가-힣\d]+\)$/u.test(
        parenthetical,
      )
        ? ""
        : parenthetical,
    );
  return value
    .replace(/\[[^\]]*\]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}
function sentences(text) {
  return clean(text)
    .split(/(?<=[.!?])\s+/u)
    .filter((item) => item.length >= 16 && /[.!?]$/u.test(item));
}
const historicalEvent = /\d{3,4}년|세기|독립|식민|왕국|제국|전쟁|조약|수교/u;
const contextDependent =
  /^(이[는것때곳들후]|그[는것때곳들후]|또한|그러나|하지만|이로|그리하여|이에 따라)/u;
function sections(extract = "") {
  const sections = [];
  let current = { title: "개요", level: 1, text: "" };
  for (const line of extract.split("\n")) {
    const heading = line.match(/^(={2,6})\s*(.*?)\s*\1$/u);
    if (heading) {
      sections.push(current);
      current = { title: heading[2], level: heading[1].length, text: "" };
    } else current.text += `${line}\n`;
  }
  sections.push(current);
  return sections;
}
const skipSection = /각주|외부 링크|같이 보기|참고 문헌|참고문헌|주석/;
function chooseHistory(articleSections, overview) {
  const historySections = [];
  let historyLevel = null;
  for (const section of articleSections) {
    if (historyLevel && section.level <= historyLevel) break;
    if (!historyLevel && /^(역사|연혁)$/u.test(section.title))
      historyLevel = section.level;
    if (historyLevel && !skipSection.test(section.title))
      historySections.push(section);
  }
  let candidates = historySections
    .map((section) => sentences(section.text))
    .filter((list) => list.length);
  if (!candidates.length)
    candidates = [
      articleSections
        .filter((section) => !skipSection.test(section.title))
        .flatMap((section) => sentences(section.text))
        .filter(
          (sentence) =>
            sentence !== overview &&
            historicalEvent.test(sentence) &&
            /독립|식민|건국|건설|통합|합병|영토|정착|발견|조약|전쟁|통치|점령|분쟁|선포|수립|탐험|왕국|제국/u.test(
              sentence,
            ),
        ),
    ];
  const available = candidates
    .flat()
    .filter((sentence) => !contextDependent.test(sentence));
  const datedEvents = available.filter(
    (sentence) =>
      /\d{3,4}년|세기/u.test(sentence) &&
      /독립|식민|건국|건설|통합|합병|영토|정착|발견|조약|전쟁|혁명|헌법|공화국|왕국|제국|왕조|통일|통치|점령|선포|수립|탐험/u.test(
        sentence,
      ),
  );
  const flattened = datedEvents.length
    ? datedEvents
    : available.filter((sentence) => historicalEvent.test(sentence));
  if (flattened.length <= 4) return flattened;
  // A short chronological sample includes earlier and later history rather
  // than filling the panel entirely with the first prehistory subsection.
  const selected = [
    flattened[0],
    flattened[Math.floor(flattened.length / 3)],
    flattened[Math.floor((flattened.length * 2) / 3)],
    flattened.at(-1),
  ];
  return [...new Set(selected)];
}
function chooseRelations(articleSections, bilateral) {
  if (bilateral?.extract) {
    const relationSections = sections(bilateral.extract).filter(
      (section) => !skipSection.test(section.title),
    );
    const lead = sentences(relationSections[0].text).filter(
      (sentence) => !/관계[를는은을]? (가리|말하|일컫|의미)/u.test(sentence),
    );
    const history = relationSections
      .slice(1)
      .flatMap((section) => sentences(section.text));
    const events = [...new Set([...lead, ...history])].filter(
      (sentence) =>
        historicalEvent.test(sentence) &&
        !contextDependent.test(sentence) &&
        !(
          /북한|조선민주주의/u.test(sentence) &&
          !/대한민국|남한|남조선|한국/u.test(sentence)
        ),
    );
    return events.length ? events.slice(0, 5) : lead.slice(0, 4);
  }
  const candidates = articleSections.filter(
    (section) => !skipSection.test(section.title),
  );
  const relationSection = candidates.filter((section) =>
    /대한민국|한국과|대한 관계|대한관계/u.test(section.title),
  );
  const selected = relationSection.some(
    (section) => sentences(section.text).length,
  )
    ? relationSection
    : candidates;
  return [
    ...new Set(
      selected
        .flatMap((section) => sentences(section.text))
        .filter(
          (sentence) =>
            /대한민국|한국 전쟁|한국전쟁|한국과|한국은|한국에|남한|남조선|한인/u.test(
              sentence,
            ) &&
            /수교|외교|통상|교류|대사|전쟁|파병|이민|협정|협력|원조/u.test(
              sentence,
            ),
        ),
    ),
  ].slice(0, 4);
}
function source(page, role) {
  const revision = page.revisions?.[0];
  if (!revision?.revid) throw new Error(`Missing revision: ${page.title}`);
  return {
    role,
    title: page.title,
    author: `${page.language === "en" ? "영어" : "한국어"} 위키백과 기여자`,
    url: `https://${page.language || "ko"}.wikipedia.org/w/index.php?oldid=${revision.revid}`,
    historyUrl: `https://${page.language || "ko"}.wikipedia.org/w/index.php?title=${encodeURIComponent(page.title)}&action=history`,
    revisionId: revision.revid,
    revisedAt: revision.timestamp,
    retrievedAt: page.retrievedAt,
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
    changes:
      "개요·역사·대한민국 관계 문장 발췌, 발음·외국어 병기 괄호와 주석 번호 제거, 문단 재배열",
    sourceSha256: createHash("sha256").update(page.extract).digest("hex"),
  };
}

const profiles = [];
const diplomacyPage = await queryArticle("대한민국의 대외 관계");
const diplomacySections = sections(diplomacyPage.extract);
let cursor = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (cursor < countries.length) {
      const { id, name } = countries[cursor++].properties;
      const title = titles[id] || name;
      const page = await queryArticle(title);
      if (page.missing || !page.extract)
        throw new Error(`Missing country article ${id}: ${title}`);
      let bilateral =
        id === "KOR" ? null : await queryArticle(`대한민국-${title} 관계`);
      if (id !== "KOR" && bilateral.missing)
        bilateral = await queryArticle(`${title}-대한민국 관계`);
      const articleSections = sections(page.extract);
      const overviewSourceText = sentences(articleSections[0].text)[0];
      const overview = overviewEdits[id] || overviewSourceText;
      if (!overview) throw new Error(`Missing overview: ${id}`);
      let relations =
        id === "KOR" ? [] : chooseRelations(articleSections, bilateral);
      if (relationSelections[id]) {
        const candidates = sections(bilateral.extract).flatMap((section) =>
          sentences(section.text),
        );
        relations = relationSelections[id].map((prefix) => {
          const found = candidates.find((sentence) =>
            sentence.startsWith(prefix),
          );
          if (!found)
            throw new Error(
              `Reviewed relationship sentence changed: ${id} ${prefix}`,
            );
          return found;
        });
      }
      let diplomacyFallback = false;
      if (id !== "KOR" && !relations.length) {
        const countrySection = diplomacySections.find(
          (section) =>
            section.title.replace(/\s/gu, "") === title.replace(/\s/gu, ""),
        );
        const fallback = countrySection
          ? sentences(countrySection.text)
          : sentences(diplomacySections[0].text).filter(
              (sentence) => sentence.includes(name) && /수교/u.test(sentence),
            );
        relations = fallback
          .filter((sentence) => historicalEvent.test(sentence))
          .slice(0, 4);
        diplomacyFallback = !!relations.length;
      }
      const allCountrySentences = articleSections.flatMap((section) =>
        sentences(section.text),
      );
      const history = historySelections[id]
        ? historySelections[id].map((prefix) => {
            const found = allCountrySentences.find((sentence) =>
              sentence.startsWith(prefix),
            );
            if (!found)
              throw new Error(
                `Reviewed history sentence changed: ${id} ${prefix}`,
              );
            return found;
          })
        : chooseHistory(articleSections, overview);
      const editorialChanges = overviewEdits[id]
        ? [
            {
              field: "overview",
              sourceText: overviewSourceText,
              text: overview,
              reason:
                "깨진 외국어 병기와 중복 수식어를 정리하여 지리적 정의로 축약",
            },
          ]
        : [];
      let historySupplement = null;
      if (id === "CCK") {
        historySupplement = await queryArticle("Cocos (Keeling) Islands", "en");
        const translatedHistory = [
          {
            sourceText:
              "The British annexed the islands in 1857, and for the next century they were administered from either Ceylon or Singapore.",
            text: "영국은 1857년 코코스 제도를 병합했고, 이후 약 한 세기 동안 실론이나 싱가포르에서 이 제도를 관할했다.",
          },
          {
            sourceText:
              "The territory was transferred to Australia in 1955, although until 1979 virtually all of the territory's real estate still belonged to the Clunies-Ross family.",
            text: "1955년 코코스 제도는 오스트레일리아로 이관되었지만, 1979년까지 거의 모든 토지는 클루니스로스 가문의 소유로 남아 있었다.",
          },
        ];
        for (const translated of translatedHistory) {
          if (!historySupplement.extract.includes(translated.sourceText))
            throw new Error("Cocos reviewed source sentence changed");
          history.push(translated.text);
          editorialChanges.push({
            field: "history",
            ...translated,
            reason:
              "영어 위키백과의 영국 병합·오스트레일리아 이관 연혁을 한국어로 번역",
          });
        }
      }
      relations = relations.map((text) => {
        const edited = text
          .replace("대한민국과 탄자니아는 두 나라는", "대한민국과 탄자니아는")
          .replace("타이베이과 단교하고", "중화민국과 단교하고");
        if (edited !== text)
          editorialChanges.push({
            field: "relations",
            sourceText: text,
            text: edited,
            reason: "중복 주어와 조사를 정리하고 국가 지칭을 명확히 함",
          });
        return edited;
      });
      const seenEstablishment = new Set();
      relations = relations
        .filter((text) => {
          if (!/수교|외교 관계.*수립/u.test(text)) return true;
          const years = [...text.matchAll(/(\d{4})년/gu)].map(
            (match) => match[1],
          );
          if (years.length !== 1) return true;
          if (seenEstablishment.has(years[0])) return false;
          seenEstablishment.add(years[0]);
          return true;
        })
        .slice(0, 4);
      profiles.push({
        id,
        name,
        overview,
        history,
        relations,
        relationshipStatus:
          id === "KOR"
            ? "domestic"
            : relations.length
              ? "documented"
              : "not-found",
        ...(editorialChanges.length ? { editorialChanges } : {}),
        sources: [
          source(page, "country"),
          ...(bilateral?.extract && relations.length
            ? [source(bilateral, "relations")]
            : []),
          ...(diplomacyFallback ? [source(diplomacyPage, "relations")] : []),
          ...(historySupplement
            ? [
                {
                  ...source(historySupplement, "history"),
                  changes:
                    "영어 위키백과 연혁 2문장 발췌·한국어 번역, 연도와 소유권 조건 보존",
                },
              ]
            : []),
        ],
      });
      if (overviewEdits[id])
        profiles.at(-1).sources[0].changes +=
          ", 개요의 외국어 병기와 중복 수식어 정리·축약";
      if (editorialChanges.some((change) => change.field === "relations"))
        profiles
          .at(-1)
          .sources.filter((source) => source.role === "relations")
          .forEach((source) => {
            source.changes += ", 중복 주어·조사·국가 지칭 정리";
          });
      if (profiles.length % 20 === 0)
        console.log(`${profiles.length}/${countries.length} country profiles`);
    }
  }),
);
profiles.sort((a, b) => a.id.localeCompare(b.id));
const output = { schemaVersion: 1, license: "CC BY-SA 4.0", profiles };
const bytes = `${JSON.stringify(output, null, 2)}\n`;
await writeFile(path.join(root, "src/data/atlas/country-profiles.json"), bytes);
console.log(
  JSON.stringify({
    count: profiles.length,
    documentedRelations: profiles.filter(
      (item) => item.relationshipStatus === "documented",
    ).length,
    missingRelations: profiles
      .filter((item) => item.relationshipStatus === "not-found")
      .map((item) => item.id),
    missingHistory: profiles
      .filter((item) => !item.history.length)
      .map((item) => item.id),
    bytes: Buffer.byteLength(bytes),
  }),
);
