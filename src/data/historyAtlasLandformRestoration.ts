import type { AtlasPlace } from "../lib/historyAtlas";
import type { AtlasHistoricalStory } from "../lib/historyAtlasStories";

const aks = (title: string, article: string) => ({
  title: `한국학중앙연구원 한국민족문화대백과사전 · ${title}`,
  url: `https://encykorea.aks.ac.kr/Article/${article}`,
});
const whc = (title: string, id: string) => ({
  title: `UNESCO 세계유산센터 · ${title}`,
  url: `https://whc.unesco.org/en/list/${id}/`,
  license: "CC BY-SA IGO 3.0 · 사실을 바탕으로 한국어 요약",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
});
const desertSource = {
  title: "Natural Earth · 사막 지형과 명칭 대표점 (1:110m)",
  url: "https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_110m_geography_regions_polys.geojson",
  license: "Public domain",
  licenseUrl: "https://www.naturalearthdata.com/about/terms-of-use/",
};
const osmSource = {
  title: "OpenStreetMap 기여자 · 강줄기 좌표",
  url: "https://www.openstreetmap.org/copyright",
  license: "ODbL 1.0",
  licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
};

/** New reference points come from the bundled source geometry, never a guessed
 * city coordinate. Desert extents are rendered with their original polygons.
 */
export const atlasLandformPlaceOverrides: Record<
  string,
  Partial<AtlasPlace>
> = {
  "kr-fe954fbe1cc0": {
    kind: "desert",
    coordinates: [106.0126, 43.1336],
    locationNote:
      "Natural Earth의 고비 사막 명칭 대표점이다. 지도에서는 같은 자료의 실제 사막 면을 표시한다. 1:110m 축척으로 단순화한 현대 지형이며, 특정 역사 시대의 경계를 뜻하지 않는다.",
  },
  "world-9e21644b4935": {
    kind: "desert",
    coordinates: [12.1037, 21.9424],
    locationNote:
      "Natural Earth의 사하라 사막 명칭 대표점이다. 지도에서는 같은 자료에 포함된 두 사막 면을 함께 표시한다. 1:110m 축척으로 단순화한 현대 지형이며, 특정 역사 시대의 경계를 뜻하지 않는다.",
  },
  "kr-b92374007291": {
    coordinates: [127.564524, 36.117185],
    locationNote:
      "OpenStreetMap 금강 선 자료에서 선택한 하천 위의 대표점이다. 지도에서는 금강의 실제 선을 함께 표시하며, 대표점은 발원지·하구나 백제의 특정 유적 위치를 뜻하지 않는다.",
  },
  "world-0f91877cb13d": {
    coordinates: [4.139965, 44.032454],
    locationNote:
      "OpenStreetMap 가르강 선 자료에서 선택한 하천 위의 대표점이다. 지도에서는 가르강의 실제 선을 함께 표시하며, 대표점은 퐁뒤가르 수도교의 위치를 뜻하지 않는다.",
  },
};

export const atlasLandformLocationEvidence: Record<
  string,
  AtlasHistoricalStory["sources"]
> = {
  "kr-fe954fbe1cc0": [desertSource],
  "world-9e21644b4935": [desertSource],
  "kr-b92374007291": [
    osmSource,
    {
      title: "OpenStreetMap · 금강 원본 선",
      url: "https://www.openstreetmap.org/way/34834591",
    },
  ],
  "world-0f91877cb13d": [
    osmSource,
    {
      title: "OpenStreetMap · 가르강 원본 선",
      url: "https://www.openstreetmap.org/way/65981268",
    },
  ],
  "world-198ae4b466bd": [
    {
      title: "FAO AQUASTAT · Tigris/Dicle와 Euphrates/Firat 수계 명칭",
      url: "https://www.fao.org/4/W4356E/w4356e0w.HTM",
    },
  ],
  "world-69e57f3ecae9": [
    {
      title: "FAO AQUASTAT · Tigris/Dicle와 Euphrates/Firat 수계 명칭",
      url: "https://www.fao.org/4/W4356E/w4356e0w.HTM",
    },
  ],
  "world-5ca1981dec6b": [
    {
      title: "중국 인터넷정보센터 · 창장 상류의 퉁톈강·진사강 명칭",
      url: "https://www.china.org.cn/english/travel/40876.htm",
    },
  ],
};

/** The other restored places already have reviewed subject-region memberships.
 * The catalogue's existing Gobi ID predates the world subject index. Its
 * Mongolian location is identified in the official tentative-list source below.
 */
export const atlasLandformRegionOverrides: Record<string, string[]> = {
  "kr-fe954fbe1cc0": ["asia-east"],
};

/** Individually evidenced history restores physical places that were removed
 * with caption-only entries. ID prefixes do not determine the school subject:
 * the existing Gobi ID is shared, while this account belongs to world history.
 * Century ranges are broad contexts, not invented dates for an undated event.
 */
export const atlasLandformHistoricalStories: AtlasHistoricalStory[] = [
  {
    id: "landform-seomjin-cultural-contact",
    subject: "korea",
    placeIds: ["kr-5570d1207cdb"],
    title: "섬진강 고분에 남은 여러 문화의 만남",
    period: "5~7세기",
    startYear: 401,
    endYear: 700,
    eraIds: ["k-three-kingdoms"],
    summary:
      "섬진강 중상류에서는 가야계 돌덧널무덤과 백제계 돌방무덤 등이 확인되었다. 서로 다른 무덤과 토기는 이 유역에서 지역 세력과 주변 나라들이 교류하고 세력을 넓힌 역사를 살피는 단서이다.",
    sources: [
      {
        title:
          "전상학 · 분묘자료를 통해 본 전북 동부지역 역학관계, 전북학연구 15 (2025)",
        url: "https://doi.org/10.59592/JBST.2025.15.3",
      },
    ],
  },
  {
    id: "landform-yukon-gold-rush",
    subject: "world",
    placeIds: ["world-a6a850bff5ac"],
    title: "금광을 찾아 유콘강을 따라간 사람들",
    period: "1897~1898년",
    startYear: 1897,
    endYear: 1898,
    eraIds: ["w-modern"],
    summary:
      "클론다이크의 금 발견 소식이 퍼지자 많은 사람이 유콘강을 따라 금광으로 향했다. 골드러시는 지역 인구와 교통을 바꾸었고, 원주민 공동체의 땅과 생활에도 큰 영향을 주었다.",
    sources: [
      {
        title: "미국 국립공원청 · What Was the Klondike Gold Rush?",
        url: "https://www.nps.gov/klgo/learn/goldrush.htm",
      },
    ],
  },
  {
    id: "landform-volga-bolgar",
    subject: "world",
    placeIds: ["world-c7a7391bf2b5"],
    title: "볼가강 유역의 도시와 이슬람 수용",
    period: "922년",
    startYear: 922,
    eraIds: ["w-medieval"],
    summary:
      "볼가강 기슭의 볼가르에서는 볼가 불가르인이 이슬람을 받아들였다. 이 강변 도시는 유목 사회와 도시 사회가 교류하고 유라시아의 여러 문화가 만난 거점이었다.",
    sources: [whc("볼가르 역사·고고 유적", "981")],
  },
  {
    id: "landform-niger-trade",
    subject: "world",
    placeIds: ["world-e23017e5f507"],
    title: "나이저강과 사하라 교역 도시",
    period: "15~16세기",
    startYear: 1401,
    endYear: 1600,
    eraIds: ["w-medieval", "w-early-modern"],
    summary:
      "나이저강 수계의 젠네와 팀북투는 물길과 사하라 교역로를 통해 연결되었다. 강을 이용한 교통은 금·소금 등의 교역과 도시 성장을 뒷받침했다.",
    sources: [
      whc("팀북투", "119"),
      {
        title: "UNESCO 기록자료 · Djenné, City of Clay",
        url: "https://www.unesco.org/archives/multimedia/document-89",
      },
    ],
    related: [
      {
        placeId: "world-d12515f624d6",
        targetEntryId: "story-world-timbuktu-world-d12515f624d6",
        reason:
          "팀북투는 나이저강 수로와 사하라 교역로가 만나는 교역·학문의 거점이었다.",
      },
      {
        placeId: "world-9e21644b4935",
        targetEntryId: "story-landform-sahara-caravans-world-9e21644b4935",
        reason:
          "나이저강 유역의 교역 도시는 사하라를 건넌 대상 교역로와 연결되었다.",
      },
    ],
  },
  {
    id: "landform-han-three-kingdoms",
    subject: "korea",
    placeIds: ["kr-ec16a428bb56"],
    title: "삼국이 경쟁한 한강 유역",
    period: "6세기",
    startYear: 501,
    endYear: 600,
    eraIds: ["k-three-kingdoms"],
    summary:
      "한강 하류의 평야와 중국으로 이어지는 물길은 삼국이 경쟁한 중요한 기반이었다. 신라는 553년 한강 하류를 차지하여 서해로 나가는 길을 확보했다.",
    sources: [
      aks("한강", "E0060950"),
      aks("서울 북한산 신라 진흥왕 순수비", "E0024795"),
    ],
    related: [
      {
        placeId: "kr-7a8717a026b6",
        targetEntryId: "story-landform-bukhansan-inscription-kr-7a8717a026b6",
        reason: "북한산 진흥왕 순수비는 신라의 한강 유역 진출을 보여 준다.",
      },
    ],
  },
  {
    id: "landform-geum-baekje",
    subject: "korea",
    placeIds: ["kr-b92374007291"],
    title: "백제의 두 수도를 이은 금강",
    period: "475~660년",
    startYear: 475,
    endYear: 660,
    eraIds: ["k-three-kingdoms"],
    summary:
      "백제의 웅진과 사비는 금강 유역에 자리했다. 금강은 두 수도의 생활과 교통을 뒷받침했고, 바다를 통한 대외 교류에도 이용되었다.",
    sources: [aks("금강", "E0007485")],
    related: [
      {
        placeId: "gongju",
        targetEntryId: "story-korea-baekje-ungjin-gongju",
        reason: "금강 유역의 웅진은 475년부터 백제의 수도였다.",
      },
      {
        placeId: "buyeo",
        targetEntryId: "story-korea-baekje-sabi-buyeo",
        reason: "금강 유역의 사비는 538년에 옮긴 백제의 수도였다.",
      },
    ],
  },
  {
    id: "landform-taedong-sherman",
    subject: "korea",
    placeIds: ["kr-c53cccf41247"],
    title: "대동강에서 일어난 제너럴 셔먼호 사건",
    period: "1866년",
    startYear: 1866,
    eraIds: ["k-joseon-late", "k-opening"],
    summary:
      "미국 상선 제너럴 셔먼호가 대동강을 거슬러 평양에 와서 통상을 요구했다. 평양의 관민과 충돌한 뒤 배가 불탔으며, 이 사건은 1871년 신미양요의 배경이 되었다.",
    sources: [aks("대동강", "E0014213")],
    related: [
      {
        placeId: "ganghwa",
        targetEntryId: "story-korea-sinmiyangyo-ganghwa",
        reason:
          "1866년 대동강의 제너럴 셔먼호 사건은 1871년 강화도에서 일어난 신미양요의 배경이 되었다.",
      },
    ],
  },
  {
    id: "landform-chongchon-salsu",
    subject: "korea",
    placeIds: ["kr-40c21f23f7f8"],
    title: "살수에서 수나라 군대를 물리친 고구려",
    period: "612년",
    startYear: 612,
    eraIds: ["k-three-kingdoms"],
    summary:
      "고구려의 을지문덕은 살수에서 퇴각하던 수나라 군대를 크게 물리쳤다. 우리역사넷은 살수를 오늘날의 청천강으로 설명한다. 강의 대표점이 정확한 전투 지점인 것은 아니다.",
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 살수대첩",
        url: "https://contents.history.go.kr/front/kc/printViewPopup.do?levelId=kc_i101200",
      },
    ],
  },
  {
    id: "landform-yalu-gangdong",
    subject: "korea",
    placeIds: ["kr-d99ab5e048c4"],
    title: "강동 6주와 압록강 하류",
    period: "993년",
    startYear: 993,
    eraIds: ["k-goryeo"],
    summary:
      "서희의 외교 교섭 뒤 고려는 강동 6주를 확보하며 압록강 하류 쪽으로 진출했다. 이는 압록강의 모든 유역을 곧바로 고려가 지배했다는 뜻은 아니다.",
    sources: [aks("압록강", "E0035176")],
  },
  {
    id: "landform-tumen-six-garrisons",
    subject: "korea",
    placeIds: ["kr-33853e391cbc"],
    title: "육진 개척과 두만강 유역",
    period: "15세기",
    startYear: 1401,
    endYear: 1500,
    eraIds: ["k-joseon-early"],
    summary:
      "조선은 두만강 방면에 육진을 설치하고 북방 지배를 강화했다. 두만강 유역은 조선과 여진 세력이 접촉하고 경쟁한 공간이었다.",
    sources: [aks("두만강", "E0016995")],
  },
  {
    id: "landform-namhan-grain",
    subject: "korea",
    placeIds: ["kr-411a685b3acf"],
    title: "세곡을 한양으로 실어 나른 물길",
    period: "조선시대",
    startYear: 1392,
    endYear: 1897,
    eraIds: ["k-joseon-early", "k-joseon-late"],
    summary:
      "조선은 충주의 가흥창과 원주의 흥원창 등에 세곡을 모았다. 남한강 수로는 내륙의 곡물을 한양으로 운반하는 조운 체계의 일부였다.",
    sources: [aks("강창", "E0001435")],
  },
  {
    id: "landform-yesong-byeokrando",
    subject: "korea",
    placeIds: ["kr-726f59c20eb3"],
    title: "벽란도와 고려의 국제 교역",
    period: "고려시대",
    startYear: 918,
    endYear: 1392,
    eraIds: ["k-goryeo"],
    summary:
      "예성강 하류의 벽란도에는 중국 등지에서 온 상선과 사신이 드나들었다. 이 물길은 고려의 수도 개경을 바다와 이어 주었다.",
    sources: [aks("벽란도", "E0022829")],
  },
  {
    id: "landform-baekdu-boundary",
    subject: "korea",
    placeIds: ["kr-c9c03519d737"],
    title: "백두산 정계비와 경계 조사",
    period: "1712년",
    startYear: 1712,
    eraIds: ["k-joseon-late"],
    summary:
      "조선과 청의 경계 조사 과정에서 백두산 정계비가 세워졌다. 비문에 적힌 토문강의 해석은 뒤에 간도 경계를 둘러싼 논쟁과 연결되었다.",
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 백두산 정계비",
        url: "https://contents.history.go.kr/mobile/hm/view.do?levelId=hm_099_0090",
      },
    ],
  },
  {
    id: "landform-bukhansan-inscription",
    subject: "korea",
    placeIds: ["kr-7a8717a026b6"],
    title: "신라의 한강 진출을 보여 주는 순수비",
    period: "6세기",
    startYear: 501,
    endYear: 600,
    eraIds: ["k-three-kingdoms"],
    summary:
      "북한산의 진흥왕 순수비는 신라가 한강 유역으로 세력을 넓힌 역사를 보여 준다. 왕의 순행과 수행 인물을 기록한 비문은 신라의 통치 모습을 살피는 자료이다.",
    sources: [aks("서울 북한산 신라 진흥왕 순수비", "E0024795")],
  },
  {
    id: "landform-maunryeong-inscription",
    subject: "korea",
    placeIds: ["kr-b5bf7c0c6e4d"],
    title: "진흥왕의 북방 순행을 기록한 비",
    period: "568년",
    startYear: 568,
    eraIds: ["k-three-kingdoms"],
    summary:
      "마운령 순수비는 진흥왕의 북방 순행을 기록했다. 비문에 나타난 수행 인물과 왕의 통치 이념은 신라의 영역 확대와 정치 체제를 보여 준다.",
    sources: [aks("마운령 진흥왕 순수비", "E0017412")],
    related: [
      {
        placeId: "kr-a3ba28604bd4",
        targetEntryId:
          "story-landform-hwangchoryeong-inscription-kr-a3ba28604bd4",
        reason:
          "마운령과 황초령의 순수비는 모두 568년 진흥왕의 북방 순행을 전한다.",
      },
    ],
  },
  {
    id: "landform-hwangchoryeong-inscription",
    subject: "korea",
    placeIds: ["kr-a3ba28604bd4"],
    title: "황초령 순수비와 신라의 북방 진출",
    period: "568년",
    startYear: 568,
    eraIds: ["k-three-kingdoms"],
    summary:
      "황초령 순수비는 진흥왕의 순행과 통치를 기념한 비이다. 마운령 순수비와 함께 6세기 신라가 동북 방면으로 세력을 넓힌 역사를 전한다.",
    sources: [aks("황초령 신라 진흥왕 순수비", "E0065356")],
  },
  {
    id: "landform-munsusan-french-invasion",
    subject: "korea",
    placeIds: ["kr-1d0e549f62ac"],
    title: "병인양요 때의 문수산성 전투",
    period: "1866년",
    startYear: 1866,
    eraIds: ["k-joseon-late", "k-opening"],
    summary:
      "강화 해협을 내려다보는 문수산성에서 조선군과 프랑스군이 싸웠다. 이 전투로 성곽과 내부 시설이 피해를 입었다.",
    sources: [
      {
        title: "국가유산청 · 김포 문수산성",
        url: "https://digital.khs.go.kr/heri/heriDetail.do?ctptNo=1333101390000&ctptUid=13898859674751300760",
      },
    ],
    related: [
      {
        placeId: "ganghwa",
        targetEntryId: "story-korea-byeonginyangyo-ganghwa",
        reason:
          "1866년 프랑스군은 강화도를 점령한 뒤 해협 건너 문수산성에서도 조선군과 싸웠다.",
      },
    ],
  },
  {
    id: "landform-jingang-beacon",
    subject: "korea",
    placeIds: ["kr-822a93ca9764"],
    title: "강화의 군사 신호를 전한 봉수",
    period: "조선시대",
    startYear: 1392,
    endYear: 1897,
    eraIds: ["k-joseon-early", "k-joseon-late"],
    summary:
      "진강산 정상의 봉수는 동쪽의 대포산과 서쪽의 망산에 신호를 전했다. 산의 높은 지형을 이용해 군사 정보를 전달한 조선의 통신 체계였다.",
    sources: [
      {
        title: "강화군 문화관광 · 진강산 역사탐방",
        url: "https://www.ganghwa.go.kr/open_content/tour/trip/mt/jingang.jsp",
      },
    ],
  },
  {
    id: "landform-bongcheon-beacon",
    subject: "korea",
    placeIds: ["kr-a1d1fa237489"],
    title: "하음산 봉수와 강화 북부",
    period: "조선시대",
    startYear: 1392,
    endYear: 1897,
    eraIds: ["k-joseon-early", "k-joseon-late"],
    summary:
      "봉천산은 옛 기록에서 하음산이나 봉두산으로도 불렸다. 조선시대 정상에 봉수가 설치되어 강화 북부의 군사 통신에 쓰였다.",
    sources: [
      {
        title: "강화군 문화관광 · 봉천산 역사탐방",
        url: "https://www.ganghwa.go.kr/open_content/tour/trip/mt/bongchun.jsp",
      },
    ],
  },
  {
    id: "landform-tohamsan-buddhist-art",
    subject: "korea",
    placeIds: ["kr-1cf5b8250d8f"],
    title: "토함산에 구현한 신라의 불교 세계",
    period: "8세기",
    startYear: 701,
    endYear: 800,
    eraIds: ["k-unified-silla"],
    summary:
      "토함산 자락에 조성한 석굴암과 불국사는 신라의 불교 신앙을 조각과 건축으로 표현했다. 석굴암의 석조 불상과 불국사의 석축·탑은 당시의 높은 기술을 보여 준다.",
    sources: [whc("석굴암과 불국사", "736")],
    related: [
      {
        placeId: "kr-8857f2a66644",
        targetEntryId: "story-korea-bulguksa-kr-8857f2a66644",
        reason: "토함산 자락의 불국사는 8세기 신라의 불교 건축을 보여 준다.",
      },
      {
        placeId: "kr-cf410b097a05",
        targetEntryId: "story-korea-seokguram-kr-cf410b097a05",
        reason: "토함산의 석굴암은 8세기 신라의 불교 조각과 건축을 보여 준다.",
      },
    ],
  },
  {
    id: "landform-hanyang-mountains",
    subject: "korea",
    placeIds: ["kr-e2b93425f35b", "kr-730ce45ad17a"],
    title: "산의 능선을 따라 쌓은 한양도성",
    period: "1396년",
    startYear: 1396,
    eraIds: ["k-joseon-early"],
    summary:
      "조선은 백악산·낙산·남산·인왕산의 능선을 따라 한양도성을 쌓았다. 산세를 이용한 성곽은 새 수도 한양을 방어하고 도성의 경계를 이루었다.",
    sources: [
      {
        title: "서울특별시 · 한양도성의 역사",
        url: "https://seoulcitywall.seoul.go.kr/content/8.do",
      },
    ],
  },
  {
    id: "landform-inwang-painting",
    subject: "korea",
    placeIds: ["kr-730ce45ad17a"],
    title: "정선이 그린 비 갠 인왕산",
    period: "1751년",
    startYear: 1751,
    eraIds: ["k-joseon-late"],
    summary:
      "정선은 비가 갠 인왕산의 모습을 인왕제색도에 담았다. 실제 우리 산천을 그린 이 작품은 조선 후기 진경산수화를 대표한다.",
    sources: [
      {
        title: "국립중앙박물관 · 정선의 인왕제색도",
        url: "https://www.museum.go.kr/MUSEUM/contents/M0501000000.do?relicRecommendId=962060&schM=view",
      },
    ],
  },
  {
    id: "landform-gobi-petroglyphs",
    subject: "world",
    placeIds: ["kr-fe954fbe1cc0"],
    title: "고비의 바위그림에 남은 사람들의 삶",
    period: "선사시대",
    startYear: -4000,
    endYear: -1000,
    eraIds: ["w-prehistory"],
    summary:
      "몽골 고비 지역의 바위그림에는 동물과 사람, 사냥과 의례의 모습이 남아 있다. 사막과 주변 초원에서 살던 사람들의 생활과 믿음을 보여 주는 자료이다.",
    sources: [
      {
        title:
          "몽골 유네스코 국가위원회 · 고비 암각화 유적 세계유산 잠정목록 신청 자료",
        url: "https://whc.unesco.org/en/tentativelists/5954/",
      },
    ],
  },
  {
    id: "landform-sahara-caravans",
    subject: "world",
    placeIds: ["world-9e21644b4935"],
    title: "사하라를 건넌 대상 교역",
    period: "11~16세기",
    startYear: 1001,
    endYear: 1600,
    eraIds: ["w-medieval", "w-early-modern"],
    summary:
      "사하라의 교역로에는 낙타 대상이 쉬고 물자를 교환하는 도시들이 발달했다. 모리타니의 옛 교역 도시들은 사막을 가로지르는 상업과 이슬람 학문의 중심지였다.",
    sources: [whc("우아단·칭게티·티시트·우알라타의 옛 크수르", "750")],
  },
  {
    id: "landform-mesopotamian-rivers",
    subject: "world",
    placeIds: ["world-198ae4b466bd", "world-69e57f3ecae9"],
    title: "두 강의 삼각주에서 성장한 수메르 도시",
    period: "기원전 4~3천년기",
    startYear: -4000,
    endYear: -2001,
    eraIds: ["w-ancient"],
    summary:
      "티그리스강과 유프라테스강의 하류 습지와 삼각주에서 우루크·우르·에리두 같은 수메르 도시가 발달했다. 물길과 주변의 자원은 초기 도시 사회의 형성을 뒷받침했다.",
    sources: [whc("이라크 남부 아흐와르와 메소포타미아 도시 유적", "1481")],
    related: [
      {
        placeId: "ur",
        targetEntryId: "story-world-ur-ur",
        reason:
          "우르는 티그리스강·유프라테스강 하류 삼각주에서 성장한 수메르 도시이다.",
        fromPlaceIds: ["world-198ae4b466bd", "world-69e57f3ecae9"],
      },
      {
        placeId: "world-69e57f3ecae9",
        targetEntryId: "story-landform-mesopotamian-rivers-world-69e57f3ecae9",
        reason:
          "티그리스강과 유프라테스강은 메소포타미아 하류의 삼각주를 함께 이룬다.",
        fromPlaceIds: ["world-198ae4b466bd"],
      },
    ],
  },
  {
    id: "landform-yangtze-liangzhu",
    subject: "world",
    placeIds: ["world-5ca1981dec6b"],
    title: "창장 유역의 벼농사와 량주 문명",
    period: "기원전 3300~2300년경",
    startYear: -3300,
    endYear: -2300,
    eraIds: ["w-ancient"],
    summary:
      "창장 하류의 량주에서는 벼농사를 바탕으로 초기 국가가 성장했다. 도시 유적과 댐·수리 시설은 물을 관리하며 농업과 도시 생활을 조직한 모습을 보여 준다.",
    sources: [whc("량주 고성 유적", "1592")],
  },
  {
    id: "landform-tennessee-tva",
    subject: "world",
    placeIds: ["world-f8592a7dda54"],
    title: "뉴딜 정책과 테네시강 개발",
    period: "1933년",
    startYear: 1933,
    eraIds: ["w-wars"],
    summary:
      "미국은 대공황기에 테네시강 유역 개발 공사(TVA)를 설립했다. 홍수 조절과 수운 개선, 전력 공급을 함께 추진한 지역 개발은 뉴딜 정책의 주요 사례이다.",
    sources: [
      {
        title: "Tennessee Valley Authority · Our History",
        url: "https://www.tva.com/About-TVA/Our-History",
      },
    ],
  },
  {
    id: "landform-danube-roman-frontier",
    subject: "world",
    placeIds: ["world-4966c2abef75"],
    title: "로마의 국경이자 교역 통로였던 강",
    period: "1~5세기",
    startYear: 1,
    endYear: 500,
    eraIds: ["w-ancient"],
    summary:
      "다뉴브강 서부 구간은 로마 제국의 북쪽 국경을 이루었다. 강을 따라 요새와 감시초소가 이어졌으며, 평화로운 시기에는 강을 건너는 사람과 교역을 관리했다.",
    sources: [whc("로마 제국의 국경: 다뉴브 리메스 서부 구간", "1608")],
  },
  {
    id: "landform-gardon-aqueduct",
    subject: "world",
    placeIds: ["world-0f91877cb13d"],
    title: "강을 건너 도시로 물을 보낸 로마 수도교",
    period: "1세기",
    startYear: 1,
    endYear: 100,
    eraIds: ["w-ancient"],
    summary:
      "로마인은 가르강을 가로지르는 퐁뒤가르 수도교를 세워 님에 물을 공급했다. 여러 층의 아치 구조는 강의 계곡을 넘도록 만든 로마 토목 기술을 보여 준다.",
    sources: [whc("퐁뒤가르 로마 수도교", "344")],
  },
  {
    id: "landform-mississippi-civil-war",
    subject: "world",
    placeIds: ["world-be499697ff1d"],
    title: "남북전쟁의 보급로를 가른 미시시피강",
    period: "1863년",
    startYear: 1863,
    eraIds: ["w-modern"],
    summary:
      "미시시피강의 통제권은 남북전쟁의 수송과 보급에 중요했다. 북군은 빅스버그를 포위해 함락시키며 강을 장악하고 남부를 분리하는 데 결정적인 진전을 이루었다.",
    sources: [
      {
        title:
          "미국 국립공원청 · Vicksburg National Military Park Foundation Document",
        url: "https://www.nps.gov/vick/learn/management/upload/FoundationDocumentOverviewAccessible.pdf",
      },
    ],
  },
  {
    id: "landform-indian-ocean-trade",
    subject: "world",
    placeIds: ["world-f034321149eb", "world-f965876f357b"],
    title: "아시아를 이어 준 바닷길",
    period: "8세기",
    startYear: 701,
    endYear: 800,
    eraIds: ["w-medieval"],
    summary:
      "아라비아해를 거쳐 인도양으로 이어진 항로는 중세 해상 교역망의 중요한 부분이었다. 8세기에는 아라비아와 중국을 잇는 바닷길이 형성되었고, 상인들은 상품과 함께 종교·지식·기술을 전했다.",
    sources: [
      {
        title: "UNESCO · About the Silk Roads",
        url: "https://www.unesco.org/en/silk-roads/about-silk-roads",
      },
    ],
  },
  {
    id: "landform-tianshan-silk-roads",
    subject: "world",
    placeIds: ["world-4d3d1971afbb"],
    title: "톈산 남북의 비단길",
    period: "기원전 2세기~16세기",
    startYear: -200,
    endYear: 1600,
    eraIds: ["w-ancient", "w-medieval", "w-early-modern"],
    summary:
      "비단길은 톈산의 북쪽과 남쪽을 따라 이어지고 산길을 넘어 중앙아시아의 계곡으로 연결되었다. 이 길을 통해 상품뿐 아니라 불교를 비롯한 종교와 기술도 이동했다.",
    sources: [whc("장안·톈산 회랑의 비단길 교역로망", "1442")],
    related: [
      {
        placeId: "world-bf0c345a5654",
        targetEntryId: "story-world-dunhuang-world-bf0c345a5654",
        reason:
          "둔황을 지난 비단길은 톈산의 남북을 따라 중앙아시아로 이어졌다.",
      },
      {
        placeId: "xian",
        targetEntryId: "story-world-changan-tang-xian",
        reason:
          "당의 수도 장안은 톈산 방면으로 이어지는 비단길의 출발 거점이었다.",
      },
    ],
  },
  {
    id: "landform-andes-inca-roads",
    subject: "world",
    placeIds: ["world-4cb39933e3e3"],
    title: "안데스를 연결한 잉카의 도로망",
    period: "15세기",
    startYear: 1401,
    endYear: 1500,
    eraIds: ["w-medieval"],
    summary:
      "잉카의 도로망 카팍냔은 안데스의 높은 산과 계곡, 해안을 연결했다. 15세기에 크게 확장된 이 길은 통신·교역·방어를 뒷받침하며 제국의 여러 지역을 이어 주었다.",
    sources: [whc("카팍냔: 안데스 도로 체계", "1459")],
    related: [
      {
        placeId: "world-df9ce94dff2b",
        targetEntryId: "story-world-cusco-world-df9ce94dff2b",
        reason:
          "안데스의 잉카 도로망은 수도 쿠스코에서 여러 지역으로 뻗어 나갔다.",
      },
    ],
  },
  {
    id: "landform-alps-lake-settlements",
    subject: "world",
    placeIds: ["world-626081f0c472"],
    title: "알프스 주변 호숫가의 선사 생활",
    period: "기원전 5000~500년경",
    startYear: -5000,
    endYear: -500,
    eraIds: ["w-prehistory"],
    summary:
      "알프스 주변 호수와 습지에는 나무 기둥 위에 집을 지은 선사 마을이 남아 있다. 물속에서 보존된 생활 도구와 유기물은 초기 농경 사회가 환경에 적응한 모습을 보여 준다.",
    sources: [whc("알프스 주변의 선사시대 호상 가옥", "1363")],
  },
  {
    id: "landform-pacific-galleons",
    subject: "world",
    placeIds: ["world-4af3e3ae890b"],
    title: "태평양을 오간 마닐라 갈레온",
    period: "1565~1815년",
    startYear: 1565,
    endYear: 1815,
    eraIds: ["w-early-modern"],
    summary:
      "마닐라와 아카풀코 사이를 오간 갈레온은 태평양을 가로질러 아시아 상품을 아메리카로 실어 날랐다. 돌아오는 배에는 금과 은, 선교사와 여러 승객이 함께 탔다.",
    sources: [
      {
        title: "미국 해양대기청 · Manila Galleon Voyages",
        url: "https://psl.noaa.gov/spotlight/2004/manila-galleon.html",
      },
    ],
    related: [
      {
        placeId: "world-287e29e93d5f",
        targetEntryId: "story-world-manila-world-287e29e93d5f",
        reason:
          "마닐라는 태평양을 건너 아카풀코와 교역한 갈레온 항로의 아시아 거점이었다.",
      },
      {
        placeId: "world-68f0c26b6639",
        targetEntryId: "story-world-manila-world-68f0c26b6639",
        reason: "아카풀코는 태평양 갈레온 항로가 닿은 아메리카의 항구였다.",
      },
    ],
  },
  {
    id: "landform-atlantic-slave-trade",
    subject: "world",
    placeIds: ["world-d664cad55b6d"],
    title: "대서양을 건넌 강제 이주",
    period: "16~19세기",
    startYear: 1501,
    endYear: 1900,
    eraIds: ["w-early-modern", "w-modern"],
    summary:
      "대서양 노예무역으로 수많은 아프리카인이 강제로 아메리카에 끌려갔다. 이 항로는 식민지 경제를 확대하는 동시에 사람들의 자유와 삶을 파괴한 역사를 담고 있다.",
    sources: [
      {
        title: "UNESCO 세계기록유산 · 영국령 카리브 지역 노예 등록부",
        url: "https://www.unesco.org/en/memory-world/registry-slaves-british-caribbean-1817-1834?hub=1081",
      },
    ],
  },
  {
    id: "landform-hanseatic-seas",
    subject: "world",
    placeIds: ["world-bfd1be5f7369", "world-284634c1c038"],
    title: "북해와 발트해의 한자 동맹 교역",
    period: "13~16세기",
    startYear: 1201,
    endYear: 1600,
    eraIds: ["w-medieval", "w-early-modern"],
    summary:
      "뤼베크를 비롯한 한자 동맹의 도시들은 북해와 발트해를 잇는 교역망을 운영했다. 상인과 항구 도시의 협력은 북유럽의 상업과 도시 성장을 이끌었다.",
    sources: [whc("한자 도시 뤼베크", "272")],
    related: [
      {
        placeId: "world-a4fdb35d4967",
        targetEntryId: "story-restored-world-a4fdb35d4967-world-a4fdb35d4967",
        reason: "뤼베크는 북해와 발트해 교역을 이끈 한자 동맹의 중심 도시였다.",
        fromPlaceIds: ["world-bfd1be5f7369", "world-284634c1c038"],
      },
      {
        placeId: "world-284634c1c038",
        targetEntryId: "story-landform-hanseatic-seas-world-284634c1c038",
        reason: "한자 동맹의 교역망은 북해와 발트해의 항구 도시를 연결했다.",
        fromPlaceIds: ["world-bfd1be5f7369"],
      },
    ],
  },
  {
    id: "landform-mediterranean-carthage",
    subject: "world",
    placeIds: ["world-dc4c95b06fa9"],
    title: "서지중해의 교역 중심 카르타고",
    period: "기원전 9~2세기",
    startYear: -900,
    endYear: -146,
    eraIds: ["w-ancient"],
    summary:
      "페니키아인이 세운 카르타고는 서지중해의 교역 중심지로 성장했다. 지중해의 주도권을 놓고 로마와 경쟁했으며, 기원전 146년 로마군에 파괴되었다.",
    sources: [whc("카르타고 유적", "37")],
    related: [
      {
        placeId: "world-9f0de41cfebd",
        targetEntryId: "story-world-carthage-world-9f0de41cfebd",
        reason:
          "카르타고는 서지중해의 주도권을 놓고 로마와 경쟁한 해상 강국이었다.",
      },
    ],
  },
];
