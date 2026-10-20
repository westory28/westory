import type { AtlasGeographicReference } from "../lib/historyAtlasGeographicReferences";
import { atlasEastAsiaCityReferences } from "./historyAtlasEastAsiaCities";

const source = (title: string, url: string) => ({ title, url });
const aks = (title: string, article: string) =>
  source(
    `한국학중앙연구원 한국민족문화대백과사전 · ${title}`,
    `https://encykorea.aks.ac.kr/Article/${article}`,
  );
const naturalEarthLicense = {
  license: "Public domain",
  licenseUrl: "https://www.naturalearthdata.com/about/terms-of-use/",
};
const riverSource = {
  ...source(
    "Natural Earth · 하천 위치·명칭 자료",
    "https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-rivers-lake-centerlines/",
  ),
  ...naturalEarthLicense,
};
const physicalSource = {
  ...source(
    "Natural Earth · 지형 명칭과 분포 참고 범위",
    "https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_10m_geography_regions_polys.geojson",
  ),
  ...naturalEarthLicense,
};
const regionNote = (point: string) =>
  `${point}에 둔 지명 표시용 근사 대표점이다. 출처의 지리적 설명을 바탕으로 배치했으며, 특정 도시·사건의 위치나 시대별 경계·영유권을 나타내지 않는다.`;
const riverNote =
  "Natural Earth의 현대 하천 선 자료 위에서 고른 대표점이다. 지도에는 원천 자료에 포함된 현대 하천 구간만 표시하며, 발원지부터 하구까지 완전하게 복원한 선은 아니다. 대표점은 발원지·하구나 역사적 사건의 위치를 뜻하지 않으며, 옛 물길은 현재와 다를 수 있다.";

/**
 * Undated geographic background for the Northeast Asia teaching map.
 * Region coordinates are deliberately approximate label anchors, not capitals
 * or invented polygon centroids. evidenceBounds are review envelopes only.
 * Natural landform IDs refer to the pinned terrain.sources.json dataset;
 * no historical region is assigned an unrelated modern natural polygon.
 */
export const atlasEastAsiaReferences: AtlasGeographicReference[] = [
  ...atlasEastAsiaCityReferences,
  {
    place: {
      id: "kr-852d5ee145ae",
      name: "요동",
      aliases: ["遼東", "辽东", "랴오둥", "Liaodong"],
      kind: "region",
      coordinates: [123.4, 41.3],
      locationNote: regionNote("요하 동쪽의 랴오양 일대"),
    },
    definition:
      "요하 동쪽에 펼쳐진 중국 동북부의 지역명이다. 오늘날 랴오닝성 남동부 일대에 해당하며, 남쪽으로 뻗은 요동반도보다 넓은 지역을 가리킨다.",
    facts: [
      {
        label: "이름의 기준",
        value: "요하를 기준으로 동쪽은 요동, 서쪽은 요서라고 부른다.",
      },
      {
        label: "범위",
        value:
          "시대별 행정구역인 요동군과 일반 지리명인 요동의 범위는 서로 다르다.",
      },
    ],
    sources: [
      source(
        "대만 교육부 국어사전 · 遼東",
        "https://dict.revised.moe.edu.tw/dictView.jsp?ID=63083&la=0&powerMode=0",
      ),
    ],
    evidenceBounds: [121.5, 38.5, 125.5, 43.5],
  },
  {
    place: {
      id: "kr-4b6883e78792",
      name: "요서",
      aliases: ["遼西", "辽西", "랴오시", "Liaoxi"],
      kind: "region",
      coordinates: [120.5, 41.6],
      locationNote: regionNote("요하 서쪽의 랴오닝성 서부"),
    },
    definition:
      "요하 서쪽을 가리키는 지역명이다. 중국 동북부에서 요동으로 이어지는 랴오닝성 서부 일대를 이해할 때 쓰인다.",
    facts: [
      {
        label: "이름의 기준",
        value: "요하 동쪽의 요동과 짝을 이루는 지명이다.",
      },
      {
        label: "범위",
        value: "일반적인 지역명과 역사상의 요서군은 같은 경계를 뜻하지 않는다.",
      },
    ],
    sources: [
      source(
        "대만 교육부 국어사전 · 遼西",
        "https://dict.revised.moe.edu.tw/dictView.jsp?ID=63101&la=1&powerMode=0",
      ),
    ],
    evidenceBounds: [118.5, 39.5, 122.5, 43.5],
  },
  {
    place: {
      id: "kr-5e1e634ba163",
      name: "만주",
      aliases: ["滿洲", "满洲", "만주지방", "Manchuria"],
      kind: "region",
      coordinates: [126, 44],
      locationNote: regionNote("중국 동북부의 지린성 중부"),
    },
    definition:
      "중국 동북부를 가리키는 역사 지리명이다. 보통 랴오닝·지린·헤이룽장성과 내몽골 동부를 포함하는 넓은 지역을 뜻한다.",
    facts: [
      {
        label: "명칭",
        value: "사용된 시대와 문헌에 따라 가리키는 범위가 달라졌다.",
      },
      {
        label: "구분",
        value:
          "하나의 도시나 현대 행정구역이 아니며, 만주 평원만을 뜻하지도 않는다.",
      },
    ],
    sources: [aks("만주", "E0017721")],
    evidenceBounds: [118, 38.5, 135.5, 54],
  },
  {
    place: {
      id: "kr-c4baf4496c37",
      name: "간도",
      aliases: ["間島", "间岛", "북간도", "동간도", "Gando"],
      kind: "region",
      coordinates: [129.2, 42.8],
      locationNote: regionNote("두만강 북쪽 연변 일대"),
    },
    definition:
      "주로 두만강 북쪽의 연변 일대를 가리키는 역사 지리명이다. 이 지역을 북간도 또는 동간도라고도 하며, 넓게는 압록강 상류 북쪽의 서간도까지 포함해 쓰였다.",
    facts: [
      {
        label: "북간도·동간도",
        value: "두만강 북쪽의 연변 일대를 중심으로 한 명칭이다.",
      },
      {
        label: "서간도",
        value:
          "압록강 상류 북쪽 지역을 가리키며, 지도 대표점이 놓인 북간도와 구별한다.",
      },
      {
        label: "범위",
        value:
          "사용 맥락에 따라 범위가 달라지는 지명으로, 현대의 단일 행정구역이 아니다.",
      },
    ],
    sources: [aks("간도", "E0000512")],
    evidenceBounds: [127.5, 42, 131, 44.5],
  },
  {
    place: {
      id: "kr-6c3a9774fc76",
      name: "연해주",
      aliases: ["沿海州", "프리모르스키 지방", "Primorye", "Primorsky Krai"],
      kind: "region",
      coordinates: [133.5, 44.8],
      locationNote: regionNote("러시아 연해주 중남부"),
    },
    definition:
      "동해에 접한 러시아 극동 남부의 지역이다. 서쪽으로 중국, 서남쪽으로 북한과 맞닿으며 남부에 블라디보스토크가 있다.",
    facts: [
      { label: "현대 명칭", value: "러시아의 프리모르스키 지방에 해당한다." },
      {
        label: "위치",
        value:
          "북쪽으로 하바롭스크 지방과 이어지고, 동쪽과 남쪽은 동해 연안이다.",
      },
    ],
    sources: [
      source(
        "러시아과학아카데미 극동지질연구소 · 연해주 지리",
        "https://www.fegi.ru/primorye/geogr/geograf.htm",
      ),
    ],
    evidenceBounds: [130.4, 42.3, 139.04, 48.39],
  },
  {
    place: {
      id: "east-asia-ordos",
      name: "오르도스",
      aliases: ["鄂爾多斯", "鄂尔多斯", "Ordos"],
      kind: "region",
      coordinates: [108.8, 39.2],
      locationNote: regionNote("황허의 큰 굽이 안쪽 오르도스 고원"),
    },
    definition:
      "황허가 서쪽·북쪽·동쪽을 크게 둘러 흐르는 고원 지역이다. 내몽골 남부를 중심으로 펼쳐지며 남쪽으로 황토고원과 이어진다.",
    facts: [
      {
        label: "지형",
        value: "고원 안에 초원과 사막·사질 지대가 함께 분포한다.",
      },
      {
        label: "범위",
        value:
          "지리적 오르도스와 현대 오르도스시, 오르도스 사막의 범위는 서로 다르다.",
      },
    ],
    sources: [
      source(
        "베이징사범대학교 지리 연구 자료 · 오르도스",
        "https://espre.bnu.edu.cn/spj/fujian/a-18.pdf",
      ),
      source(
        "중국 생태계 연구 네트워크 · 오르도스 관측소",
        "https://www.cnern.ac.cn/getContent_class.action?article_class_id=2&class_id=esd3&id=19499&pid=esdroot",
      ),
    ],
    evidenceBounds: [106, 37, 112, 41],
  },
  {
    place: {
      id: "world-7cc2ca430928",
      name: "화북",
      aliases: ["華北", "华北", "화베이", "North China"],
      kind: "region",
      coordinates: [115, 38],
      locationNote: regionNote("화북 평원의 허베이성 일대"),
    },
    definition:
      "중국 북부를 가리키는 광역 지명이다. 역사 지리에서는 화북 평원과 황허 중하류를 중심으로 설명하지만, 현대의 지역 구분과 시대별 쓰임은 서로 다르다.",
    facts: [
      {
        label: "대표 지역",
        value:
          "베이징·톈진과 허베이·산시·산둥·허난 일대가 화북 역사 연구에서 다루어진다.",
      },
      {
        label: "범위",
        value: "현대의 광역 구분을 모든 시대에 같은 경계로 적용하지 않는다.",
      },
    ],
    sources: [
      source(
        "전국철학사회과학공작판공실 · 仲伟民, 화북의 역사적 범위",
        "https://www.nopss.gov.cn/n1/2022/0926/c219544-32533908.html",
      ),
    ],
    evidenceBounds: [108, 33, 121, 42],
  },
  {
    place: {
      id: "east-asia-central-plain",
      name: "중원",
      aliases: ["中原", "Central Plain", "Zhongyuan"],
      kind: "region",
      coordinates: [113.5, 34.8],
      locationNote: regionNote("황허 중하류의 허난성 중부"),
    },
    definition:
      "허난 일대를 중심으로 한 황허 중하류의 지역명이다. 넓은 의미로는 주변 지역도 포함하므로 오늘날 허난성의 경계와 정확히 같지는 않다.",
    facts: [
      {
        label: "대표 지역",
        value: "뤄양·정저우·카이펑이 있는 허난 일대가 중심에 놓인다.",
      },
      {
        label: "범위",
        value: "문헌과 연구 주제에 따라 넓고 좁은 의미로 쓰인다.",
      },
    ],
    sources: [
      source(
        "전국철학사회과학공작판공실 · 중원 지역 역사 연구",
        "https://www.nopss.gov.cn/GB/219506/219508/219522/14640073.html",
      ),
    ],
    evidenceBounds: [110, 32, 117, 37],
  },
  {
    place: {
      id: "world-bf91277b21a8",
      name: "강남",
      aliases: ["江南", "강남지방", "장난", "Jiangnan"],
      kind: "region",
      coordinates: [119.5, 30.6],
      locationNote: regionNote("장강 하류 남쪽의 타이후 서남부"),
    },
    definition:
      "장강 남쪽을 뜻하는 지역명이다. 좁게는 장강 하류 남쪽의 타이후와 쑤저우·항저우 일대를 중심으로 하며, 시대와 문맥에 따라 더 넓게 쓰인다.",
    facts: [
      { label: "이름의 기준", value: "강남의 ‘강’은 장강을 가리킨다." },
      {
        label: "범위",
        value:
          "장강 이남 전체를 뜻할 때와 하류의 특정 문화·경제 지역을 뜻할 때를 구별한다.",
      },
    ],
    sources: [
      source(
        "중국 국무원 참사실 · 葛剑雄, 강남의 역사 지리",
        "https://www.counsellor.gov.cn/2019-06/11/c_1210401482.htm",
      ),
    ],
    evidenceBounds: [117, 28.5, 122, 32.5],
  },
  {
    place: {
      id: "east-asia-central-china",
      name: "화중",
      aliases: ["華中", "华中", "화중지방", "Central China"],
      kind: "region",
      coordinates: [113.5, 30],
      locationNote: regionNote("장강 중류의 후베이성 남부"),
    },
    definition:
      "중국 중부, 특히 장강 중류를 중심으로 쓰이는 광역 지명이다. 후베이·후난·장시 일대를 중심으로 설명하거나 장강 하류까지 넓혀 부르기도 한다.",
    facts: [
      {
        label: "대표 지형",
        value: "장강 중류와 그 주변의 평야·호수 지역이 중심에 있다.",
      },
      {
        label: "범위",
        value:
          "역사 지리의 화중과 현대 행정·경제 구분의 범위는 일치하지 않을 수 있다.",
      },
    ],
    sources: [
      source(
        "쇼가쿠칸 일본대백과전서 · 華中",
        "https://kotobank.jp/word/華中-463983",
      ),
    ],
    evidenceBounds: [108, 26, 118, 33],
  },
  {
    place: {
      id: "east-asia-south-china",
      name: "화남",
      aliases: ["華南", "华南", "화남지방", "South China"],
      kind: "region",
      coordinates: [111.5, 24],
      locationNote: regionNote("광둥성과 광시 사이의 중국 남부"),
    },
    definition:
      "중국 남부를 가리키는 광역 지명이다. 광둥·광시·하이난 일대를 중심으로 쓰이며, 자료에 따라 포함하는 지역이 달라진다.",
    facts: [
      {
        label: "대표 지역",
        value: "광저우가 있는 광둥과 그 서쪽의 광시, 남쪽의 하이난이 포함된다.",
      },
      {
        label: "범위",
        value:
          "강남과 동의어가 아니며, 특정 왕조의 영토를 나타내는 이름도 아니다.",
      },
    ],
    sources: [
      source(
        "대만 교육부 국어사전 · 華南",
        "https://dict.revised.moe.edu.tw/dictView.jsp?ID=83640&la=1&powerMode=0",
      ),
      source(
        "쇼가쿠칸 일본대백과전서 · 華南",
        "https://kotobank.jp/word/華南-465221",
      ),
    ],
    evidenceBounds: [104, 18, 117, 27],
  },
  {
    place: {
      id: "east-asia-southwest-china",
      name: "서남",
      aliases: ["西南", "중국 서남", "서남지방", "Southwest China"],
      kind: "region",
      coordinates: [104.5, 28],
      locationNote: regionNote("쓰촨 분지 남쪽과 윈구이 고원 사이"),
    },
    definition:
      "중국 서남부를 가리키는 광역 지명이다. 쓰촨 분지와 윈난·구이저우의 고원 지대가 중심에 있으며, 현대 구분에서는 시짱도 포함한다.",
    facts: [
      {
        label: "현대 구분",
        value: "쓰촨·충칭·윈난·구이저우·시짱을 묶는 구분이 사용된다.",
      },
      {
        label: "범위",
        value: "시대별 행정구역이나 하나의 자연 지형을 가리키는 이름은 아니다.",
      },
    ],
    sources: [
      source(
        "베이징시 인민정부 · 국무원 공문 주제어표의 지역 구분",
        "https://www.beijing.gov.cn/gate/big5/www.beijing.gov.cn/zhengce/zfwj/zfwj/bgtwj/201905/t20190523_74177.html",
      ),
    ],
    evidenceBounds: [78, 21, 110.5, 36.5],
  },
  {
    place: {
      id: "east-asia-liaodong-peninsula",
      name: "요동반도",
      aliases: ["遼東半島", "辽东半岛", "랴오둥반도", "Liaodong Peninsula"],
      kind: "region",
      coordinates: [122.2, 39.8],
      locationNote: regionNote("요동반도 중부"),
    },
    definition:
      "중국 랴오닝성 남쪽에서 보하이해와 황해 사이로 뻗은 반도이다. 반도의 남단에 다롄과 뤼순이 있으며, 요동이라는 광역 지명보다 좁은 자연 지형을 뜻한다.",
    facts: [
      { label: "주변 바다", value: "서쪽은 보하이해, 동쪽은 황해이다." },
      {
        label: "구분",
        value: "요하 동쪽의 넓은 지역인 요동과 요동반도는 구별한다.",
      },
    ],
    sources: [
      source(
        "쇼가쿠칸 일본대백과전서 · 遼東半島",
        "https://kotobank.jp/word/遼東半島-150056",
      ),
    ],
    evidenceBounds: [120.9, 38.6, 124.4, 40.8],
  },
  {
    place: {
      id: "kr-c6ca41fa64db",
      name: "산둥반도",
      aliases: ["山東半島", "山东半岛", "산동반도", "Shandong Peninsula"],
      kind: "region",
      coordinates: [120.7, 37],
      locationNote: regionNote("산둥반도의 옌타이 남부"),
    },
    definition:
      "중국 산둥성 동부에서 바다로 돌출한 반도이다. 자오라이 저지대 동쪽에 놓이며, 북쪽의 보하이해와 남쪽·동쪽의 황해 사이에 있다.",
    facts: [
      { label: "주변 지역", value: "북쪽 바다 건너에 요동반도가 있다." },
      {
        label: "범위",
        value: "산둥성 전체가 아니라 그 동쪽의 반도 지형을 가리킨다.",
      },
    ],
    sources: [
      source(
        "대만 교육부 국어사전 · 山東半島",
        "https://dict.revised.moe.edu.tw/dictView.jsp?ID=130644&q=1&word=東",
      ),
      source(
        "옌타이시 인민대표대회 · 옌타이의 지리적 위치",
        "https://renda.yantai.gov.cn/art/2022/10/25/art_106338_1345.html",
      ),
    ],
    evidenceBounds: [119.3, 35.7, 122.8, 38.5],
  },
  {
    place: {
      id: "world-05bf185a28a3",
      name: "규슈",
      aliases: ["九州", "큐슈", "Kyushu"],
      kind: "island",
      coordinates: [131.11562, 32.4691],
      locationNote:
        "Natural Earth의 규슈 섬 명칭 대표점이다. 일본 국토지리원의 지형 자료와 대조한 현대 섬의 위치이며, 규슈 지방에 포함되는 모든 부속 섬의 범위를 뜻하지 않는다.",
    },
    definition:
      "일본 열도 서남부에 있는 큰 섬이다. 혼슈의 서남쪽에 놓이며, 한반도 남쪽에서 대한해협을 건너 이어지는 지역이다.",
    facts: [
      {
        label: "대표 도시",
        value: "북부의 후쿠오카, 서부의 나가사키, 중부의 구마모토 등이 있다.",
      },
      {
        label: "명칭 구분",
        value: "규슈 섬과 주변 섬들을 함께 포함하는 규슈 지방의 범위는 다르다.",
      },
    ],
    sources: [
      physicalSource,
      source(
        "일본 국토지리원 · 규슈 지방의 지형",
        "https://www.gsi.go.jp/kikaku/tenkei_kyushu.html",
      ),
    ],
    evidenceBounds: [129.5, 30.9, 132.1, 34.1],
  },
  {
    place: {
      id: "kr-fe954fbe1cc0",
      name: "고비 사막",
      aliases: ["고비사막", "戈壁", "Gobi", "Gobi Desert"],
      kind: "desert",
      coordinates: [106.0126, 43.1336],
      locationNote:
        "Natural Earth 1:110m 자료의 고비 사막 명칭 대표점이다. 표시되는 사막 면은 현대의 분포를 단순화한 것으로, 사막의 정밀한 경계나 역사적 영역을 뜻하지 않는다.",
    },
    definition:
      "몽골 남부와 중국 북부에 걸친 넓은 건조 지역이다. 몽골 고원 일대에 분포하며 타클라마칸 사막과는 별개의 사막이다.",
    facts: [
      { label: "위치", value: "몽골 남부에서 중국 내몽골 일대로 이어진다." },
      {
        label: "지도 범위",
        value: "사막 분포를 일반화한 현대 지리 자료를 사용한다.",
      },
    ],
    sources: [
      {
        ...source(
          "Natural Earth · 고비 사막 지형과 대표점 (1:110m)",
          "https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_110m_geography_regions_polys.geojson",
        ),
        ...naturalEarthLicense,
      },
      source(
        "NASA Earth Observatory · 고비 사막의 위치",
        "https://science.nasa.gov/earth/earth-observatory/finding-fossils-from-space/",
      ),
    ],
    evidenceBounds: [90, 37, 117, 48],
  },
  {
    place: {
      id: "world-767aab168ab8",
      name: "타클라마칸사막",
      aliases: [
        "타클라마칸 사막",
        "타클리마칸 사막",
        "塔克拉玛干沙漠",
        "Taklamakan",
        "Taklimakan",
      ],
      kind: "desert",
      coordinates: [82.77503, 38.90855],
      locationNote:
        "Natural Earth 지형 자료의 타클라마칸 사막 명칭 대표점이다. 분포 면은 약 1:50,000,000 수준의 개략적인 지형 범위이며, 모래 지대의 정밀한 경계가 아니다.",
    },
    definition:
      "중국 서부 신장 지역의 타림 분지에 있는 사막이다. 북쪽의 톈산산맥과 남쪽의 쿤룬산맥 사이에 넓게 펼쳐진다.",
    facts: [
      {
        label: "지형",
        value: "타림 분지 안에 큰 모래언덕 지대가 발달해 있다.",
      },
      {
        label: "구분",
        value: "몽골 남부와 중국 북부의 고비 사막보다 서쪽에 위치한다.",
      },
    ],
    sources: [
      physicalSource,
      source(
        "NASA Earth Observatory · 타클라마칸 사막과 타림 분지",
        "https://science.nasa.gov/earth/earth-observatory/the-taklimakan-desert-a-factory-for-dust-storms-87969/",
      ),
    ],
    evidenceBounds: [76, 36, 91, 42],
    terrainId: "ne-1159103651",
  },
  {
    place: {
      id: "world-535241559ce3",
      name: "티베트고원",
      aliases: [
        "티베트 고원",
        "시짱고원",
        "칭짱고원",
        "青藏高原",
        "Tibetan Plateau",
      ],
      kind: "mountain",
      coordinates: [89.22722, 33.34669],
      locationNote:
        "Natural Earth 지형 자료의 티베트고원 명칭 대표점이다. 분포 면은 약 1:50,000,000 수준의 개략적인 지형 범위이며, 시짱 자치구의 행정 경계나 고원 전체의 정밀한 경계가 아니다.",
    },
    definition:
      "히말라야산맥 북쪽에 넓게 펼쳐진 높은 고원이다. 남쪽의 인도 아대륙과 히말라야산맥을 사이에 두며, 주변 산맥과 함께 아시아 내륙의 큰 지형을 이룬다.",
    facts: [
      {
        label: "지형",
        value: "하나의 산봉우리가 아니라 넓은 고원과 산지의 집합이다.",
      },
      {
        label: "범위",
        value:
          "지형으로서의 티베트고원과 현대 시짱 자치구는 같은 범위가 아니다.",
      },
    ],
    sources: [
      physicalSource,
      source(
        "NASA · 티베트고원과 히말라야의 위치",
        "https://www.nasa.gov/image-article/himalayas-separate-tibetan-plateau-from-indian-subcontinent/",
      ),
    ],
    evidenceBounds: [75, 26, 105, 40],
    terrainId: "ne-1159104345",
  },
  {
    place: {
      id: "kr-67297dfc092b",
      name: "랴오허강",
      aliases: ["요하", "요하강", "료하", "遼河", "辽河", "Liao", "Liao He"],
      kind: "water",
      coordinates: [122.95045, 42.009223],
      locationNote:
        "명칭 대표점은 Natural Earth의 선 자료 위에 있다. 표시선은 OpenStreetMap relation 405843의 현대 요하 본류를 사용하며, 판진의 솽타이쯔허 하구로 이어진다. 잉커우로 흐르는 다랴오허와 구별하며, 역사 시대의 물길을 복원한 선은 아니다.",
    },
    definition:
      "중국 동북부를 흐르는 강으로 한국 한자음으로는 요하라고 한다. 동·서 랴오허가 합쳐진 본류는 랴오닝성을 지나 보하이해 쪽으로 흐른다.",
    facts: [
      {
        label: "다른 이름",
        value: "요하·요하강은 랴오허강을 가리키는 이름이다.",
      },
      {
        label: "주변 지명",
        value: "요동과 요서는 이 강의 동쪽·서쪽이라는 뜻에서 비롯한다.",
      },
      {
        label: "현대 물길",
        value:
          "본류 하류의 솽타이쯔허와 훈허·타이쯔허가 합쳐진 다랴오허는 구별한다.",
      },
    ],
    sources: [
      riverSource,
      {
        title: "OpenStreetMap 기여자 · 요하 본류 relation 405843",
        url: "https://www.openstreetmap.org/relation/405843",
        license: "ODbL 1.0",
        licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
      },
      source(
        "선양농업대학교 수리학원 · 랴오허 본류",
        "https://slxy.syau.edu.cn/info/1333/5809.htm",
      ),
      source(
        "판진시 문화여유방송국 · 요하와 다랴오허의 물길 분리",
        "https://wlgdj.panjin.gov.cn/2021_04/01_09/content-315702.html",
      ),
    ],
    evidenceBounds: [119, 40.5, 125.5, 44.5],
  },
  {
    place: {
      id: "kr-bf616421c82e",
      name: "쑹화강",
      aliases: ["송화강", "松花江", "Songhua", "Sungari"],
      kind: "water",
      coordinates: [126.637625, 45.785671],
      locationNote: riverNote,
    },
    definition:
      "중국 동북부를 흐르는 헤이룽강·아무르강 수계의 큰 강이다. 넌강과 제2쑹화강이 합쳐진 뒤 하얼빈·자무쓰를 지나 퉁장 부근에서 헤이룽강과 만난다.",
    facts: [
      { label: "다른 이름", value: "한국 한자음으로 송화강이라고도 한다." },
      {
        label: "수계",
        value: "넌강과 제2쑹화강의 물을 모아 헤이룽강으로 흐른다.",
      },
    ],
    sources: [
      riverSource,
      source(
        "닝샤 수리청 · 쑹화강 개요",
        "https://slt.nx.gov.cn/xxgk_281/fdzdgknr/slkp/jhzl/202104/t20210409_2718496.html",
      ),
    ],
    evidenceBounds: [123, 41, 133, 48],
  },
  {
    place: {
      id: "world-87d1fde40816",
      name: "황허강",
      aliases: ["황하", "황하강", "황허", "黃河", "黄河", "Yellow River"],
      kind: "water",
      coordinates: [104.325613, 37.152696],
      locationNote: riverNote,
    },
    definition:
      "중국 칭하이의 고원 지대에서 시작하여 중국 북부를 거쳐 보하이해로 흐르는 강이다. 한국 한자음으로 황하라고 부른다.",
    facts: [
      {
        label: "흐름",
        value:
          "오르도스 주위에서 크게 굽이친 뒤 황허 중하류의 평야로 이어진다.",
      },
      {
        label: "옛 물길",
        value:
          "하류는 역사적으로 여러 차례 물길이 바뀌었으므로 현대 선을 과거 모든 시대에 적용할 수 없다.",
      },
    ],
    sources: [
      riverSource,
      source(
        "웨이하이시 수무국 · 황허의 흐름과 하도 변화",
        "https://slj.weihai.gov.cn/art/2020/10/27/art_2632_2424837.html",
      ),
    ],
    evidenceBounds: [95, 32, 120, 42],
  },
  {
    place: {
      id: "world-2406582c375c",
      name: "화이허강",
      aliases: ["회수", "회하", "淮水", "淮河", "화이허", "Huai", "Huai He"],
      kind: "water",
      coordinates: [114.552745, 32.301703],
      locationNote: riverNote,
    },
    definition:
      "황허와 장강 사이에서 동쪽으로 흐르는 강이다. 허난성 퉁바이산에서 시작하여 안후이를 거쳐 장쑤의 훙쩌호로 이어지며, 한국 한자음의 회수도 이 강을 가리킨다.",
    facts: [
      { label: "다른 이름", value: "화이허강·회수는 같은 강의 이름이다." },
      {
        label: "현대 하류",
        value:
          "훙쩌호 아래에서는 장강으로 이어지는 수로와 바다로 이어지는 배수로로 물이 나뉜다.",
      },
    ],
    sources: [
      riverSource,
      source(
        "난양시 생태환경국 · 화이허의 발원과 흐름",
        "https://sthj.nanyang.gov.cn/2022/11-24/160908.html",
      ),
      source(
        "장쑤성 정협 · 화이허 하류 수로",
        "https://www.jszx.gov.cn/wylz/zxta/2009ta/202205/t20220525_60485.html",
      ),
    ],
    evidenceBounds: [112, 31, 121, 35],
  },
  {
    place: {
      id: "world-5ca1981dec6b",
      name: "창장강",
      aliases: [
        "창장",
        "장강",
        "양쯔강",
        "長江",
        "长江",
        "Chang Jiang",
        "Yangtze",
      ],
      kind: "water",
      coordinates: [114.303233, 30.593044],
      locationNote: riverNote,
    },
    definition:
      "중국 서부의 고원에서 시작하여 중국 중부를 가로질러 동중국해로 흐르는 강이다. 장강·양쯔강이라는 이름으로도 알려져 있다.",
    facts: [
      {
        label: "상류 명칭",
        value: "퉁톈강과 진사강으로 불리는 상류 구간도 장강 수계에 속한다.",
      },
      {
        label: "주변 지명",
        value:
          "강남은 이 강 남쪽을 가리키는 이름이며, 화중은 중류 일대를 중심으로 쓰인다.",
      },
    ],
    sources: [
      riverSource,
      source(
        "중국 인터넷정보센터 · 장강과 상류의 명칭",
        "https://www.china.org.cn/english/travel/40876.htm",
      ),
    ],
    evidenceBounds: [90, 24, 123, 36],
  },
  {
    place: {
      id: "kr-d99ab5e048c4",
      name: "압록강",
      aliases: ["鴨綠江", "鸭绿江", "Yalu"],
      kind: "water",
      coordinates: [126.045095, 40.944892],
      locationNote: riverNote,
    },
    definition:
      "백두산 부근에서 발원하여 한반도 북서쪽을 따라 황해로 흐르는 강이다. 오늘날 대부분의 구간에서 북한과 중국의 국경을 이룬다.",
    facts: [
      { label: "흐름", value: "혜산·만포·신의주 일대를 지나 황해로 이어진다." },
      {
        label: "두만강과의 구분",
        value: "압록강은 서쪽의 황해로, 두만강은 동쪽의 동해로 흐른다.",
      },
    ],
    sources: [riverSource, aks("압록강", "E0035176")],
    evidenceBounds: [123.5, 39.5, 128.5, 42.5],
  },
  {
    place: {
      id: "kr-33853e391cbc",
      name: "두만강",
      aliases: ["豆滿江", "图们江", "도문강", "Tumen"],
      kind: "water",
      coordinates: [129.433849, 42.441352],
      locationNote: riverNote,
    },
    definition:
      "백두산 동남쪽 산지에서 시작하여 한반도 북동쪽을 따라 동해로 흐르는 강이다. 북한과 중국 사이를 흐르다가 하구 부근에서는 북한과 러시아의 경계를 이룬다.",
    facts: [
      {
        label: "주변 지역",
        value: "강 북쪽의 연변 일대는 북간도라는 역사 지리명과 연결된다.",
      },
      {
        label: "압록강과의 구분",
        value: "두만강은 동해로, 압록강은 황해로 흐른다.",
      },
    ],
    sources: [riverSource, aks("두만강", "E0016995")],
    evidenceBounds: [128, 41, 131, 43.5],
  },
];
