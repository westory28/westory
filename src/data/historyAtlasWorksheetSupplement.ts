import type { AtlasPlace } from "../lib/historyAtlas";
import type { AtlasHistoricalStory } from "../lib/historyAtlasStories";

/** Reviewed against the thirteen uploaded 2026-2 worksheets on 2026-11-06.
 * Points locate a site, island or explicitly described reference area; they
 * never reconstruct a battlefield, former shoreline or administrative border.
 */
interface WorksheetPlaceReview {
  place: AtlasPlace;
  existing: boolean;
  regionId: string;
  worksheet: string;
  definition: string;
  story: Omit<AtlasHistoricalStory, "id" | "subject" | "placeIds">;
}

const wikidataPoint = (id: string, title: string) => ({
  title: `Wikidata · ${title} 대표 좌표 (${id})`,
  url: `https://www.wikidata.org/wiki/${id}`,
  license: "CC0 1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
});
const heritagePoint = (
  kind: string,
  number: string,
  region: string,
  title: string,
) => ({
  title: `국가유산청 · ${title} 등록 위치`,
  url: `https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=${kind}&ccbaAsno=${number}&ccbaCtcd=${region}`,
});
const battlePoint = {
  title: "한국학중앙연구원 · 민족기록화 전자지도, 이순신 해전 전적지",
  url: "https://dh.aks.ac.kr/Encyves/wiki/index.php/민족기록화_전자지도",
};

export const atlasWorksheetPlaceReviews: WorksheetPlaceReview[] = [
  {
    place: {
      id: "worksheet-sarhu",
      name: "사르후",
      aliases: ["사르후 전투", "살이호", "薩爾滸", "萨尔浒", "Sarhu"],
      modernName: "중국 랴오닝성 푸순현 사르후성 유적 일대",
      kind: "site",
      coordinates: [124.26474, 41.907075],
      locationNote:
        "랴오닝성 문화여유청의 위치 설명과 대조한 사르후성 유적 일대의 대표점이다. 전투는 여러 지역에서 벌어졌으며, 조선군이 싸운 심하·부차의 정확한 전장을 나타내지 않는다.",
    },
    existing: false,
    regionId: "outside-korea",
    worksheet: "4-4-2-1. 광해군의 중립 외교와 몰락.pdf",
    definition:
      "사르후는 오늘날 중국 랴오닝성 푸순 동쪽의 옛 지명으로, 1619년 후금이 명의 군대를 크게 물리친 전투의 이름이 된 곳이다.",
    story: {
      title: "명·후금의 세력 관계를 바꾼 사르후 전투",
      period: "1619년",
      startYear: 1619,
      eraIds: ["k-joseon-late"],
      summary:
        "1619년 누르하치의 후금군은 사르후 일대를 포함한 여러 전장에서 명의 군대를 격파했다. 명을 도우러 출병한 강홍립의 조선군도 심하·부차 방면에서 싸운 뒤 항복했다. 이 전투는 명과 후금 사이에서 조선이 외교적 대응을 고민하게 된 배경이다.",
      sources: [
        {
          title: "국사편찬위원회 우리역사넷 · 심하전투",
          url: "https://contents.history.go.kr/mobile/kc/view.do?code=kc_age_30&levelId=kc_i304200",
        },
        {
          title: "랴오닝성 문화여유청 · 사르후성 유적",
          url: "https://whly.ln.gov.cn/whly/wlzt/lnww/zdwwbhdw/69858A11AF304AD3B2FAFDF2A3295DE8/index.shtml",
        },
        wikidataPoint("Q19851412", "사르후성 유적"),
      ],
    },
  },
  {
    place: {
      id: "worksheet-yukjo-street",
      name: "육조거리",
      aliases: ["육조 거리", "육조대로"],
      modernName: "서울 종로구 세종대로 광화문광장 일대",
      kind: "site",
      coordinates: [126.97666667, 37.57277778],
      locationNote:
        "육조거리가 있던 광화문 앞길을 현재 광화문광장의 대표 좌표로 표시한다. 조선 시대 거리의 전체 구간이나 개별 관청의 경계를 뜻하지 않는다.",
    },
    existing: false,
    regionId: "gyeonggi",
    worksheet: "4-1-1. 조선의 건국 과정.pdf",
    definition:
      "육조거리는 조선 시대 경복궁 광화문 앞에서 주요 관청들이 모여 있던 큰길로, 오늘날 서울 세종대로와 광화문광장 일대에 해당한다.",
    story: {
      title: "한양의 정치·행정 중심이 된 육조거리",
      period: "조선 시대",
      startYear: 1395,
      endYear: 1910,
      eraIds: ["k-joseon-early", "k-joseon-late"],
      summary:
        "조선은 경복궁 광화문 앞의 넓은 길 양쪽에 의정부와 육조 등 주요 관청을 배치했다. 육조거리는 왕이 머무는 궁궐과 행정을 담당하는 관청을 연결하며 한양의 정치 중심 공간을 이루었다.",
      sources: [
        {
          title: "서울역사박물관 · 도성대지도, 경복궁·사직단 일대",
          url: "https://museum.seoul.go.kr/archive/archiveNew/NR_archiveView.do?ctgryId=CTGRY780&fileId=8e68c916-1acb-46ad-8458-2322b7f76c87&fileSn=1100&type=C&upperNodeId=CTGRY780",
        },
        wikidataPoint("Q5623300", "광화문광장"),
      ],
    },
  },
  {
    place: {
      id: "kr-f4b0f5784697",
      name: "숙정문",
      aliases: ["숙청문", "북대문"],
      modernName: "서울 종로구 삼청동과 성북구 성북동 사이 한양도성",
      kind: "site",
      coordinates: [126.981111, 37.595556],
      locationNote:
        "한양도성 북문인 숙정문의 대표 위치이다. 도성의 전체 경계나 건립 당시 성문의 측량 위치를 뜻하지 않는다.",
    },
    existing: true,
    regionId: "gyeonggi",
    worksheet: "4-1-1. 조선의 건국 과정.pdf",
    definition:
      "숙정문은 한양도성의 북쪽 큰 문이다. 태조 때 세워졌으며 처음에는 숙청문이라고 불렸다.",
    story: {
      title: "한양도성의 북쪽 문, 숙정문",
      period: "1396년 이후",
      startYear: 1396,
      eraIds: ["k-joseon-early", "k-joseon-late"],
      summary:
        "숙정문은 1396년 한양도성을 쌓을 때 만든 북쪽 성문이다. 처음에는 숙청문이라 불렸으며 평소 통행은 제한되었다. 한양의 성문 배치와 수도를 둘러싼 산지 지형을 함께 살펴볼 수 있는 장소이다.",
      sources: [
        {
          title: "서울역사박물관 · 숙정문: 폐쇄된 성문을 열다",
          url: "https://museum.seoul.go.kr/www/board/NR_boardView.do?bbsCd=1159&seq=20230705145630777&sso=ok",
        },
        wikidataPoint("Q624302", "숙정문"),
      ],
    },
  },
  {
    place: {
      id: "kr-8794ff492fec",
      name: "돈의문",
      aliases: ["돈의문 터", "서대문", "새문"],
      modernName: "서울 종로구 강북삼성병원 앞 정동사거리 일대",
      kind: "site",
      coordinates: [126.968975, 37.56824444],
      locationNote:
        "현존하지 않는 돈의문의 옛 터 일대를 나타낸 대표점이다. 1396년 최초 건립 위치나 복원된 성문을 표시하는 점은 아니다.",
    },
    existing: true,
    regionId: "gyeonggi",
    worksheet: "4-1-1. 조선의 건국 과정.pdf",
    definition:
      "돈의문은 한양도성의 서쪽 큰 문으로 서대문이라고도 한다. 현재 문은 남아 있지 않으며 서울 정동사거리 일대에 옛 터가 있다.",
    story: {
      title: "한양도성의 서쪽 관문이었던 돈의문",
      period: "조선 시대",
      startYear: 1396,
      endYear: 1910,
      eraIds: ["k-joseon-early", "k-joseon-late"],
      summary:
        "돈의문은 한양도성 서쪽에서 도성 안팎을 연결하던 성문이다. 조선 초 문을 옮겨 세운 뒤 새문이라고도 불렸으며, 오늘날 새문안이라는 지명에 그 흔적이 남아 있다. 일제강점기에 철거되어 현재는 문터로 남아 있다.",
      sources: [
        {
          title: "서울특별시 · 한양도성 인왕산 구간과 돈의문 터",
          url: "https://mediahub.seoul.go.kr/archives/1184401",
        },
        wikidataPoint("Q483836", "돈의문 옛 터"),
      ],
    },
  },
  {
    place: {
      id: "kr-1369d9862dee",
      name: "사직",
      aliases: ["사직단", "서울 사직단"],
      modernName: "서울 종로구 사직동 사직단",
      kind: "site",
      coordinates: [126.967669, 37.57561],
      locationNote:
        "국가유산청이 공개한 사직단의 등록 위치이다. 토지와 곡식의 신에게 제사 지내던 제단 일대이며 사직공원 전체의 경계는 아니다.",
    },
    existing: true,
    regionId: "gyeonggi",
    worksheet: "4-1-1. 조선의 건국 과정.pdf",
    definition:
      "사직단은 조선이 토지의 신인 사와 곡식의 신인 직에게 제사를 지내던 제단이다. 한양에서는 경복궁 서쪽에 설치했다.",
    story: {
      title: "토지와 곡식의 신에게 제사 지낸 사직단",
      period: "1395년 이후",
      startYear: 1395,
      eraIds: ["k-joseon-early", "k-joseon-late"],
      summary:
        "조선은 한양으로 도읍을 옮기면서 경복궁 동쪽에 왕실 조상을 모시는 종묘를, 서쪽에는 토지와 곡식의 신에게 제사 지내는 사직단을 설치했다. 농업과 왕조의 안정을 기원하는 국가 제사 공간이었다.",
      sources: [
        {
          title: "국가유산청 · 사직단 안내판",
          url: "https://www.heritage.go.kr/heri/cul/culGuidePostDetail.do?ccbaCpno=1331101210000&ccgbGbtype=UNI&ccgbGbtypeNo=2&pageNo=1_5_0_0",
        },
        heritagePoint("13", "0001210000000", "11", "사직단"),
      ],
    },
  },
  {
    place: {
      id: "kr-cfcd0e4e5bd4",
      name: "제포",
      aliases: ["내이포", "제포성지", "제포진성"],
      modernName: "경남 창원시 진해구 제덕동 일대",
      kind: "settlement",
      coordinates: [128.742312, 35.105596],
      locationNote:
        "제포를 지키던 제포성지의 국가유산 등록 좌표를 포구 일대의 대표점으로 사용한다. 조선 시대 부두나 해안선의 정확한 위치는 아니다.",
    },
    existing: true,
    regionId: "gyeongsang",
    worksheet: "4-1-3, 4. 조선 전기 지방 제도와 대외 관계.pdf",
    definition:
      "제포는 오늘날 창원시 진해구에 있던 포구로, 조선 전기에 일본과 교역하도록 연 삼포 가운데 하나이다.",
    story: {
      title: "삼포 교역과 해상 방어의 거점, 제포",
      period: "조선 전기",
      startYear: 1407,
      endYear: 1510,
      eraIds: ["k-joseon-early"],
      replacesEntryIds: ["kr-entry-859ee6a1e2b2"],
      summary:
        "제포는 부산포·염포와 함께 일본과의 교역을 위해 개방한 포구이다. 왜관을 두어 일본인의 왕래와 거주를 관리했고, 주변에는 수군이 머무는 진성을 쌓았다. 1510년 삼포왜란이 일어난 곳 가운데 하나이다.",
      sources: [
        {
          title: "한국학중앙연구원 · 제포",
          url: "https://encykorea.aks.ac.kr/Article/E0051508",
        },
        {
          title: "한국학중앙연구원 HeritageWiki · 창원 진해 제포진성",
          url: "https://dh.aks.ac.kr/~heritage/wiki/index.php/창원_진해_제포진성",
        },
        heritagePoint("23", "0001840000000", "38", "창원 제포성지"),
      ],
    },
  },
  {
    place: {
      id: "kr-08b2887f4e5e",
      name: "부산포",
      modernName: "부산 동구 좌천동·부산진성 주변의 옛 포구",
      kind: "settlement",
      coordinates: [129.061163, 35.136166],
      locationNote:
        "부산포 일대를 가리키기 위해 인근 부산진성의 국가유산 등록 위치를 대표점으로 사용한다. 현대 부산항 전체나 조선 전기 왜관·부두·해안선의 정확한 위치는 아니다.",
    },
    existing: true,
    regionId: "gyeongsang",
    worksheet: "4-1-3, 4. 조선 전기 지방 제도와 대외 관계.pdf",
    definition:
      "부산포는 오늘날 부산 동구 좌천동과 부산진성 주변에 있던 옛 포구로, 조선 전기 삼포 교역의 한 거점이다.",
    story: {
      title: "조선과 일본의 교역 창구, 부산포",
      period: "조선 전기",
      startYear: 1407,
      endYear: 1592,
      eraIds: ["k-joseon-early"],
      replacesEntryIds: ["kr-entry-c75db4531f00"],
      summary:
        "조선은 부산포에 왜관을 두고 일본인과의 교역을 관리했다. 제포·염포와 함께 삼포로 불렸으며, 군사적 방어와 외교·무역의 기능이 겹치는 포구였다. 당시의 포구는 현재 부산항의 전체 범위와 구별해야 한다.",
      sources: [
        {
          title: "한국학중앙연구원 · 부산광역시 동구",
          url: "https://encykorea.aks.ac.kr/Article/E0066982",
        },
        {
          title: "부산광역시 부산시보 · 부산포의 위치와 역사",
          url: "https://www.busan.go.kr/news/storyreport/view?dataNo=67338&gugun=Next",
        },
        heritagePoint("23", "0000070000000", "21", "부산진성"),
      ],
    },
  },
  {
    place: {
      id: "kr-93ebbe6fe34d",
      name: "쓰시마섬",
      aliases: ["대마도", "쓰시마", "對馬島", "Tsushima"],
      modernName: "일본 나가사키현 쓰시마섬",
      kind: "island",
      coordinates: [129.333333, 34.416667],
      locationNote:
        "쓰시마섬 전체를 찾기 위한 대표점이다. 1419년 조선군의 상륙 지점이나 전투 경로, 섬의 경계를 나타내지 않는다.",
    },
    existing: true,
    regionId: "outside-korea",
    worksheet: "4-1-3, 4. 조선 전기 지방 제도와 대외 관계.pdf",
    definition:
      "대마도는 한반도와 일본 규슈 사이에 있는 쓰시마섬의 한자식 이름이다. 조선과 일본의 교역 및 왜구 대책에서 중요한 위치를 차지했다.",
    story: {
      title: "세종 때의 대마도 정벌",
      period: "1419년",
      startYear: 1419,
      eraIds: ["k-joseon-early"],
      displayNames: { "kr-93ebbe6fe34d": "대마도" },
      summary:
        "1419년 세종 때 이종무가 이끄는 조선군은 왜구의 활동을 억제하기 위해 대마도를 공격했다. 이후 조선은 방어를 강화하는 한편 대마도 세력과 외교·교역 관계를 조정하며 일본과의 교린 체제를 정비했다.",
      sources: [
        {
          title: "국사편찬위원회 우리역사넷 · 쓰시마섬의 토벌",
          url: "https://contents.history.go.kr/mobile/hm/view.do?levelId=hm_078_0060",
        },
        wikidataPoint("Q52051", "쓰시마섬"),
      ],
    },
  },
  {
    place: {
      id: "kr-c6a843e42fcc",
      name: "성균관 탕평비",
      aliases: ["탕평비"],
      modernName: "서울 종로구 성균관 일대",
      kind: "site",
      coordinates: [126.995808, 37.585683],
      locationNote:
        "탕평비가 있는 성균관 유적의 국가유산 등록 대표 좌표를 사용한다. 비석 자체의 정밀 위치나 1742년 반수교의 위치를 뜻하지 않는다.",
    },
    existing: true,
    regionId: "gyeonggi",
    worksheet: "5-1-1. 깊어지는 붕당 간의 갈등.pdf",
    definition:
      "탕평비는 영조가 1742년 성균관에 세운 비석으로, 유생들에게 당파에 치우치지 않는 공정한 마음을 당부한 글을 새겼다.",
    story: {
      title: "영조의 탕평 의지를 새긴 성균관 탕평비",
      period: "1742년",
      startYear: 1742,
      eraIds: ["k-joseon-late"],
      summary:
        "영조는 1742년 성균관 반수교에 탕평비를 세웠다. 유생들이 붕당으로 갈라져 편을 들지 않고 공정한 태도를 갖도록 당부한 것으로, 왕이 추진한 탕평 정치의 뜻을 보여 준다.",
      sources: [
        {
          title: "한국학중앙연구원 · 탕평비",
          url: "https://encykorea.aks.ac.kr/Article/E0058858",
        },
        heritagePoint("13", "0001430000000", "11", "서울 문묘와 성균관"),
      ],
    },
  },
  {
    place: {
      id: "kr-552294756bf0",
      name: "청계천",
      aliases: ["개천"],
      modernName: "서울 도심의 청계천",
      kind: "water",
      coordinates: [126.97771, 37.56902],
      locationNote:
        "청계천 상류 청계광장 부근의 대표점이다. 하천 전체의 경로나 조선 시대 준천 공사 범위를 뜻하지 않는다.",
    },
    existing: true,
    regionId: "gyeonggi",
    worksheet: "5-1-2. 개혁의 시대, 이후 흔들리는 왕권.pdf",
    definition:
      "청계천은 서울 도심을 흐르는 하천으로, 조선 시대에는 개천이라고 불렸다. 영조는 범람 피해를 줄이려고 하천 바닥을 파내는 준천 공사를 벌였다.",
    story: {
      title: "범람을 줄이기 위한 영조의 청계천 준천",
      period: "1760년",
      startYear: 1760,
      eraIds: ["k-joseon-late"],
      replacesEntryIds: ["kr-entry-e63719ab863e"],
      summary:
        "조선의 수도 한양을 흐르던 청계천은 토사가 쌓여 자주 넘쳤다. 영조는 1760년 하천 바닥의 흙과 모래를 퍼내는 대규모 준천 공사를 시행했다. 백성의 생활과 도성의 물길을 관리한 정책의 사례이다.",
      sources: [
        {
          title: "서울역사박물관 · 준천, 영조와 백성을 잇다",
          url: "https://museum.seoul.go.kr/www/board/NR_boardView.do?bbsCd=1015&seq=20170824111412692&sso=ok",
        },
        wikidataPoint("Q495437", "청계천 상류"),
      ],
    },
  },
  {
    place: {
      id: "kr-ca387c21676a",
      name: "규장각",
      aliases: ["창덕궁 규장각"],
      modernName: "서울 종로구 창덕궁 후원 주합루",
      kind: "site",
      coordinates: [126.992737, 37.581925],
      locationNote:
        "1776년 규장각이 들어선 창덕궁 주합루의 국가유산 등록 좌표이다. 오늘날 서울대학교 규장각한국학연구원의 위치와 구별한다.",
    },
    existing: true,
    regionId: "gyeonggi",
    worksheet: "5-1-2. 개혁의 시대, 이후 흔들리는 왕권.pdf",
    definition:
      "규장각은 정조가 설치한 왕실 도서관이자 학문 연구·정책 자문 기관이다. 처음 설치된 창덕궁 주합루의 아래층에 왕실 서적을 보관했다.",
    story: {
      title: "정조의 개혁 정치를 뒷받침한 규장각",
      period: "1776년 이후",
      startYear: 1776,
      eraIds: ["k-joseon-late"],
      replacesEntryIds: ["kr-entry-294b5835946e"],
      summary:
        "정조는 1776년 창덕궁 후원에 규장각과 주합루를 마련했다. 왕실 서적을 보관하는 기능에서 나아가 학문 연구와 정책 자문을 맡도록 했으며, 젊은 관료와 서얼 출신 검서관을 활용해 개혁 정치를 뒷받침했다.",
      sources: [
        {
          title: "국가유산청 궁능유적본부 · 창덕궁 소개·역사",
          url: "https://royal.khs.go.kr/ROYAL/contents/R102010000.do",
        },
        {
          title: "국가유산청 · 창덕궁 주합루",
          url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1121117690000",
        },
        {
          title: "국사편찬위원회 우리역사넷 · 규장각",
          url: "https://contents.history.go.kr/mobile/kc/view.do?levelId=kc_o300100",
        },
        heritagePoint("12", "0017690000000", "11", "창덕궁 주합루"),
      ],
    },
  },
  {
    place: {
      id: "kr-1c65dd59361b",
      name: "당포",
      aliases: ["당포 해전", "당포해전"],
      modernName: "경남 통영시 산양읍 당포 앞바다",
      kind: "settlement",
      coordinates: [128.3783723, 34.7870394],
      locationNote:
        "한국학중앙연구원 전자지도에 수록된 당포해전의 대표점이다. 함대 이동 경로나 조선 시대 포구의 정확한 해안선을 뜻하지 않는다.",
    },
    existing: true,
    regionId: "gyeongsang",
    worksheet: "4-4-1-1. 일본의 침략을 막아 내다.pdf",
    definition:
      "당포는 오늘날 통영의 포구로, 1592년 이순신의 조선 수군이 일본 함대와 싸워 승리한 당포해전의 무대이다.",
    story: {
      title: "사천에 이어 승리한 당포해전",
      period: "1592년",
      startYear: 1592,
      eraIds: ["k-joseon-early"],
      summary:
        "1592년 이순신의 조선 수군은 사천해전에 이어 당포의 일본 함대를 공격했다. 거북선 등을 앞세운 공격으로 승리했으며, 남해안에서 일본 수군의 활동과 보급을 저지하는 데 힘을 보탰다.",
      sources: [
        {
          title: "한국학중앙연구원 · 이순신",
          url: "https://encykorea.aks.ac.kr/Article/E0044900",
        },
        battlePoint,
      ],
    },
  },
  {
    place: {
      id: "kr-10da22f15d48",
      name: "사천",
      aliases: ["사천 해전", "사천해전"],
      modernName: "경남 사천시 사천만 일대",
      kind: "settlement",
      coordinates: [128.0313003, 35.0447304],
      locationNote:
        "한국학중앙연구원 전자지도에 수록된 사천해전의 대표점이다. 현대 사천시청의 위치나 전투 범위를 정밀하게 복원한 점은 아니다.",
    },
    existing: true,
    regionId: "gyeongsang",
    worksheet: "4-4-1-1. 일본의 침략을 막아 내다.pdf",
    definition:
      "사천은 경남 남해안의 고을로, 임진왜란 때 이순신이 거북선을 앞세워 일본 함대를 공격한 사천해전이 벌어진 곳이다.",
    story: {
      title: "거북선을 앞세운 사천해전",
      period: "1592년",
      startYear: 1592,
      eraIds: ["k-joseon-early"],
      summary:
        "1592년 사천 앞바다에서 이순신의 조선 수군은 일본 함대를 유인해 공격했다. 거북선을 선두에 세우고 화포와 화살로 적선을 격파하며 남해안 해전의 승리를 이어 갔다.",
      sources: [
        {
          title: "한국학중앙연구원 · 사천해전",
          url: "https://encykorea.aks.ac.kr/Article/E0026034",
        },
        battlePoint,
      ],
    },
  },
];

export const atlasWorksheetNewPlaces = atlasWorksheetPlaceReviews
  .filter((review) => !review.existing)
  .map((review) => review.place);
export const atlasWorksheetPlaceUpdates = atlasWorksheetPlaceReviews
  .filter((review) => review.existing)
  .map((review) => review.place);
export const atlasWorksheetStories: AtlasHistoricalStory[] =
  atlasWorksheetPlaceReviews.map(({ place, story }) => ({
    id: `worksheet-${place.id}`,
    subject: "korea",
    placeIds: [place.id],
    ...story,
  }));
export const atlasWorksheetRegionOverrides: Record<string, string[]> =
  Object.fromEntries(
    atlasWorksheetPlaceReviews.map(({ place, regionId }) => [
      place.id,
      [regionId],
    ]),
  );
export const atlasWorksheetWorldRegionOverrides: Record<string, string[]> = {
  "worksheet-sarhu": ["asia-east"],
  "kr-93ebbe6fe34d": ["asia-east"],
};
export const atlasWorksheetDictionaryReferences =
  atlasWorksheetPlaceReviews.map(({ place, definition, story }) => ({
    placeId: place.id,
    definition,
    sources: story.sources,
  }));
