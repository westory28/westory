import type { AtlasCitation } from "../lib/historyAtlas";
import { historyAtlasSupplementalProfiles } from "./historyAtlasSupplementalProfiles";

export interface AtlasProfileSource {
  title: string;
  url: string;
  license?: string;
  licenseUrl?: string;
}

export interface AtlasPlaceProfile {
  definition: string;
  facts: { label: string; value: string }[];
  sources: AtlasProfileSource[];
  textbookCitations?: AtlasCitation[];
  quality: "verified" | "reference" | "basic";
}

export interface CuratedAtlasPlaceProfile {
  /** Exact names only. Search aliases can denote a different landmark or an event. */
  names: string[];
  placeIds?: string[];
  definition: string;
  facts: { label: string; value: string }[];
  sources: AtlasProfileSource[];
  textbookCitations?: AtlasCitation[];
}

const aks = (name: string, article: string): AtlasProfileSource => ({
  title: `한국학중앙연구원 한국민족문화대백과사전 · ${name}`,
  url: `https://encykorea.aks.ac.kr/Article/${article}`,
});

/** Individually checked geographic profiles, reviewed 2026-10-15.
 * These supplement, rather than replace, the textbook citations on era stories.
 * Extents, river courses and present-day port boundaries are not inferred from map pins.
 */
export const historyAtlasPlaceProfiles: CuratedAtlasPlaceProfile[] = [
  ...historyAtlasSupplementalProfiles,
  {
    names: [],
    placeIds: ["kr-7fb1e90e9e47"],
    definition:
      "고려 서경의 장소로, 묘청의 건의에 따라 인종이 대화궁을 지었던 곳이다.",
    facts: [],
    sources: [aks("인종", "E0047033")],
  },
  {
    names: [],
    placeIds: ["kr-14d26b24bf6f"],
    definition: "강화도에 있었던 고려의 사찰로, 대장경판을 보관했던 곳이다.",
    facts: [],
    sources: [
      {
        title: "한국학중앙연구원 조선왕조실록사전 · 선원사",
        url: "https://dh.aks.ac.kr/sillokwiki/index.php/선원사(禪源寺)",
      },
    ],
  },
  {
    names: ["사로국"],
    definition: "경주 일대에서 성장한 진한의 소국으로, 뒤에 신라로 발전하였다.",
    facts: [],
    sources: [aks("사로국", "E0025526"), aks("신라", "E0032800")],
  },
  {
    names: ["백제국"],
    definition:
      "한강 유역에 있던 마한의 소국으로, 주변 세력을 통합하면서 백제로 성장하였다.",
    facts: [],
    sources: [aks("백제국", "E0022357")],
  },
  {
    names: ["구야국"],
    definition:
      "오늘날 김해 일대에 있던 변한의 나라로, 금관가야와 연결되는 고대 국가다.",
    facts: [],
    sources: [
      {
        title: "국사편찬위원회 한국 고대 사료 DB · 금관국 관련 주석",
        url: "https://db.history.go.kr/id/sg_004r_0030_0150",
      },
    ],
  },
  {
    names: ["부조"],
    definition:
      "옥저와 관련된 고대 지명으로, 한나라의 기록에는 낙랑군에 속한 현의 이름으로도 나온다.",
    facts: [],
    sources: [aks("부조예군묘", "E0024563")],
  },
  {
    names: ["국동대혈"],
    definition:
      "고구려 도읍 동쪽의 큰 동굴로, 하늘에 제사를 지낼 때 이곳에서 신을 맞았다고 전해진다.",
    facts: [],
    sources: [
      {
        title: "국립국어원 우리말샘 · 국동대혈",
        url: "https://kli.korean.go.kr/term/trgtWord/indexTrgtWord.do?trgtWordNo=2061095",
      },
    ],
  },
  {
    names: [],
    placeIds: ["kr-fe6083c45bfa"],
    definition:
      "황해도 봉산의 옛 지명으로, 고려 때 북방 방어와 연결되는 지역이었다.",
    facts: [],
    sources: [aks("봉주", "E0024018")],
  },
  {
    names: [],
    placeIds: ["kr-ab0228174178"],
    definition:
      "고려가 지방을 다스리기 위해 둔 도호부로, 풍주에 설치된 뒤 해주로 옮겨졌다.",
    facts: [],
    sources: [aks("안서도호부", "E0034791")],
  },
  {
    names: [],
    placeIds: ["kr-52c80072ba18"],
    definition:
      "고려의 지방 통치 기구로, 전주·고부·영암·수주 등 시대에 따라 설치 지역이 달라졌다.",
    facts: [],
    sources: [aks("안남도호부", "E0034565")],
  },
  {
    names: [],
    placeIds: ["kr-8fbc2902ad39"],
    definition:
      "고려가 안주에 두었던 도호부로, 지방 통치와 북쪽 방어를 맡는 거점이었다.",
    facts: [],
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 고려의 지방 제도",
        url: "https://contents.history.go.kr/front/ta/webBook.do?levelId=ta_p51r_0030_0020_0070_0010&md=2",
      },
    ],
  },
  {
    names: ["고조선"],
    definition:
      "한국사에서 가장 이른 시기에 등장한 국가다. 옛 기록의 조선을 후대의 조선 왕조와 구분하여 고조선이라고 부른다.",
    facts: [
      {
        label: "활동 지역",
        value:
          "요령 지역과 한반도 서북부의 문헌·유물을 함께 살펴 연구한다. 중심지가 요령에 있었다는 견해, 평양에 있었다는 견해, 중심지가 이동했다는 견해가 있어 한 지점으로 단정하기 어렵다.",
      },
      {
        label: "명칭",
        value:
          "고조선이라는 이름이 가리키는 범위는 연구 맥락에 따라 위만조선 이전에 한정되기도 하고 위만조선까지 포함하기도 한다. 특정 시대의 영역과 모든 시기의 영역을 같은 것으로 읽지 않는다.",
      },
    ],
    sources: [aks("고조선", "E0003937")],
  },
  {
    names: ["요동"],
    definition:
      "중국 동북 지역의 요하, 즉 랴오허강 동쪽을 가리키는 역사 지리 명칭이다. 오늘날의 한 도시나 고정된 행정 구역을 뜻하지 않는다.",
    facts: [
      {
        label: "지리",
        value:
          "요하를 기준으로 서쪽을 요서, 동쪽을 요동이라 구분한다. 이 구분이 유물과 문화의 분포까지 뚜렷하게 갈라 놓는 것은 아니다.",
      },
      {
        label: "고구려",
        value:
          "광개토왕 때 고구려는 요동성을 비롯한 요하 동쪽 지역을 차지하였다. 이 지역은 고구려의 서쪽 진출과 방어에 중요한 공간이었다.",
      },
    ],
    sources: [
      {
        title: "국사편찬위원회 신편 한국사 · 청동유물의 지역적 특성",
        url: "https://contents.history.go.kr/mobile/nh/view.do?levelId=nh_003_0020_0010_0030_0020",
      },
      {
        title: "국사편찬위원회 · 광개토 대왕릉 비문 내용",
        url: "https://contents.history.go.kr/eh_kk/teach/notebook/data/07_d05.htm",
      },
    ],
  },
  {
    names: ["백두산"],
    definition:
      "북한과 중국의 국경에 걸쳐 있는 화산으로, 정상부의 커다란 칼데라에 천지가 있다.",
    facts: [
      {
        label: "지형",
        value:
          "천지는 화산 분화와 함몰로 만들어진 칼데라에 물이 고인 호수다. 백두산 주변 산지는 압록강과 두만강의 발원 지역이기도 하다.",
      },
      {
        label: "분화",
        value:
          "946년 무렵의 대규모 분화는 화산재를 일본까지 퍼뜨렸다. 산 전체와 정상 호수인 천지는 구분되는 지형이다.",
      },
      {
        label: "역사",
        value:
          "1712년 조선과 청은 백두산 일대의 경계를 조사하고 정계비를 세웠다. 정계비의 경계 해석은 뒤에 간도 문제와도 연결되었다.",
      },
    ],
    sources: [
      aks("백두산", "E0022049"),
      {
        title: "Smithsonian Global Volcanism Program · Changbaishan",
        url: "https://volcano.si.edu/volcano.cfm?vn=305060",
      },
      {
        title: "국사편찬위원회 우리역사넷 · 백두산 정계비",
        url: "https://contents.history.go.kr/mobile/hm/view.do?levelId=hm_099_0090",
      },
    ],
  },
  {
    names: ["한강"],
    definition:
      "한반도 중부를 서쪽으로 흘러 서울을 지나 서해로 들어가는 강이다.",
    facts: [
      {
        label: "물길",
        value:
          "북한강과 남한강이 경기 양평의 양수리에서 합쳐진 뒤 서울과 하류 평야를 지난다.",
      },
      {
        label: "삼국 시대",
        value:
          "비옥한 농경지와 중국으로 이어지는 교통로를 확보할 수 있어 백제·고구려·신라가 한강 유역을 차지하려고 경쟁했다.",
      },
      {
        label: "조선 시대",
        value:
          "한양에 물자와 세곡을 실어 나르는 수상 교통로였으며, 강 주변 나루와 포구가 발달했다.",
      },
    ],
    sources: [aks("한강", "E0060950")],
  },
  {
    names: ["압록강"],
    definition:
      "백두산 일대에서 발원하여 북한과 중국 사이를 흐른 뒤 서해로 들어가는 강이다.",
    facts: [
      {
        label: "물길",
        value:
          "혜산·중강진·만포·신의주 일대를 지나며, 두만강과 함께 한반도 북쪽 국경을 이루는 주요 하천이다.",
      },
      {
        label: "교통과 경계",
        value:
          "강 건너 지역과 왕래하는 통로인 동시에 군사적 경계였다. 조선은 상류 지역에 4군을 설치하여 북방 지배를 강화했다.",
      },
    ],
    sources: [aks("압록강", "E0035176")],
  },
  {
    names: ["두만강"],
    definition:
      "백두산 동남쪽 산지에서 시작하여 한반도 북동쪽을 흐른 뒤 동해로 들어가는 강이다.",
    facts: [
      {
        label: "현재 위치",
        value:
          "대부분의 구간은 북한과 중국 사이를 흐르고, 하구 가까운 구간은 북한과 러시아 사이를 흐른다.",
      },
      {
        label: "역사",
        value:
          "조선은 두만강 유역에 6진을 설치했다. 19세기에는 이 강을 건너 간도와 연해주로 이주한 사람들도 있었다.",
      },
    ],
    sources: [aks("두만강", "E0016995")],
  },
  {
    names: ["낙동강"],
    definition:
      "태백 산지에서 발원하여 영남의 내륙을 지나 남해로 흘러드는 강이다.",
    facts: [
      {
        label: "물길과 평야",
        value:
          "경상도 내륙의 여러 지류를 모으며, 하류에는 넓은 충적 평야와 삼각주가 발달했다.",
      },
      {
        label: "역사",
        value:
          "강과 지류를 따라 농경과 교통이 발달했다. 가야 여러 나라와 신라의 성장도 낙동강 유역의 생활·교류권과 연결된다.",
      },
    ],
    sources: [aks("낙동강", "E0011565")],
  },
  {
    names: ["금강"],
    definition:
      "전북 장수에서 발원하여 충청 지역을 굽이쳐 흐른 뒤 군산 앞 서해로 들어가는 강이다.",
    facts: [
      {
        label: "물길",
        value:
          "장수의 뜬봉샘에서 시작하여 공주와 부여를 지난다. 부여 부근의 강 구간은 백마강으로도 불린다.",
      },
      {
        label: "백제",
        value:
          "백제의 수도였던 웅진과 사비가 강가에 자리했다. 강은 내륙의 도성과 서해를 이어 주는 교통로였다.",
      },
    ],
    sources: [aks("금강", "E0007485")],
  },
  {
    names: ["대동강"],
    definition:
      "북한 북부의 낭림산맥에서 시작하여 평양을 지나 남포 부근의 서해로 들어가는 강이다.",
    facts: [
      {
        label: "유역",
        value:
          "중·하류의 평양 일대에는 평야가 펼쳐져 있으며, 강을 이용한 농업과 수상 교통이 발달했다.",
      },
      {
        label: "역사",
        value:
          "고구려가 수도로 삼았던 평양과 서해를 연결하는 물길이다. 평양의 도시 발달은 강 주변의 평야와 교통 조건에 밀접하게 연결되었다.",
      },
    ],
    sources: [aks("대동강", "E0014213")],
  },
  {
    names: ["청천강"],
    definition:
      "북한 자강도의 산지에서 발원하여 안주와 박천 사이를 지나 서해로 들어가는 강이다.",
    facts: [
      {
        label: "유역",
        value:
          "하류에는 안주평야와 박천평야가 있으며, 강은 평안남도와 평안북도 사이의 경계 일부를 이룬다.",
      },
      {
        label: "옛 이름과 전투",
        value:
          "살수라고도 불렸다. 612년 고구려가 수의 침입군을 물리친 살수 대첩과 관련된 강이다.",
      },
    ],
    sources: [aks("청천강", "E0056781")],
  },
  {
    names: ["예성강"],
    definition:
      "황해도 내륙에서 남쪽으로 흘러 개성 서쪽을 지나 서해로 들어가는 강이다.",
    facts: [
      {
        label: "교통",
        value:
          "하류의 벽란도에서 배를 타고 서해로 나갈 수 있었다. 벽란도와 고려의 수도 개경 사이는 육로로 이어졌다.",
      },
      {
        label: "고려의 교류",
        value:
          "송의 사절과 상인들이 벽란도를 드나들었다. 예성강 하구는 개경과 해외 교역망을 연결하는 관문이었다.",
      },
    ],
    sources: [
      aks("벽란도", "E0022829"),
      {
        title: "국사편찬위원회 우리역사넷 · 벽란도",
        url: "https://contents.history.go.kr/mobile/kc/view.do?levelId=kc_r200325",
      },
    ],
  },
  {
    names: ["울산항"],
    placeIds: ["ulsan"],
    definition:
      "울산의 해안에 자리한 항만으로, 오늘날에는 울산 산업단지와 연결된 주요 무역항이다.",
    facts: [
      {
        label: "현대 항만",
        value:
          "1963년 개항한 현대 울산항은 산업화와 함께 성장했다. 조선 시대 염포나 고대의 교역 공간과 항만의 범위가 같지는 않다.",
      },
      {
        label: "역사 속 항구",
        value:
          "울산 지역의 염포는 조선이 일본과의 교역을 위해 연 삼포 중 하나였다. 시대별 항구의 위치와 기능을 구분해서 보아야 한다.",
      },
    ],
    sources: [
      {
        title: "울산지방해양수산청 · 울산항의 역사",
        url: "https://ulsan.mof.go.kr/ko/page.do?menuIdx=801",
      },
      {
        title: "울산항만공사 · 울산항 역사",
        url: "https://www.upa.or.kr/portal/contents.do?mid=0706010100",
      },
    ],
  },
  {
    names: ["염포"],
    definition:
      "오늘날 울산광역시 북구 염포동 일대에 있었던 포구로, 조선 시대 일본과 교역하던 삼포 중 하나다.",
    facts: [
      {
        label: "삼포",
        value:
          "부산포·제포와 함께 일본인의 왕래와 교역을 위해 열린 항구였다. 오늘날의 울산항 전체를 가리키는 이름은 아니다.",
      },
      {
        label: "지역의 변화",
        value:
          "소금과 포구의 역사를 지닌 지역에서 현대의 자동차 산업 지역으로 변화했다. 염포동의 소금포역사관에서 이 지역의 역사를 다룬다.",
      },
    ],
    sources: [
      {
        title: "울산 북구 · 소금포역사관",
        url: "https://www.bukgu.ulsan.kr/lay1/S1T1831C2057/contents.do",
      },
      {
        title: "울산지방해양수산청 · 울산항의 역사",
        url: "https://ulsan.mof.go.kr/ko/page.do?menuIdx=801",
      },
    ],
  },
  {
    names: ["나일강"],
    definition:
      "아프리카 동북부를 북쪽으로 흘러 수단과 이집트를 지나 지중해로 들어가는 강이다.",
    facts: [
      {
        label: "두 물줄기",
        value:
          "백나일강과 청나일강이 수단의 하르툼에서 합쳐진다. 청나일강은 에티오피아 고원에서, 백나일강의 수계는 동아프리카의 호수와 산지에서 물을 모은다.",
      },
      {
        label: "유역",
        value:
          "강 본류와 여러 지류가 이루는 유역은 여러 나라에 걸친다. 본류가 통과하는 나라와 강물의 유역에 속하는 나라는 구분된다.",
      },
    ],
    sources: [
      {
        title: "Nile Basin Initiative · The Nile Basin",
        url: "https://nilebasin.org/nile-basin",
      },
      {
        title: "Nile Basin Initiative · Sudan baseline, chapters 1–3",
        url: "https://nilebasin.org/sites/default/files/2023-09/wbBaselineSudan_chapter1-3.pdf",
      },
    ],
  },
  {
    names: ["티그리스강"],
    definition:
      "튀르키예 동부에서 발원하여 이라크로 흐르는 강으로, 메소포타미아를 이루는 두 큰 강 중 동쪽 강이다.",
    facts: [
      {
        label: "메소포타미아",
        value:
          "서쪽의 유프라테스강과 함께 메소포타미아의 강 유역을 이룬다. 강물을 이용한 관개는 건조한 이라크의 농업에 중요하다.",
      },
      {
        label: "하류",
        value:
          "유프라테스강과 합류한 뒤에는 샤트알아랍강으로 이어져 페르시아만으로 흘러든다.",
      },
    ],
    sources: [
      {
        title: "FAO · Irrigation in the Near East region — Iraq",
        url: "https://www.fao.org/4/W4356E/w4356e0e.HTM",
      },
      {
        title: "FAO AGROVOC · Tigris River",
        url: "https://agrovoc.fao.org/browse/agrovoc/en/page/c_29747",
      },
    ],
  },
  {
    names: ["유프라테스강"],
    definition:
      "튀르키예 동부에서 시작하여 시리아와 이라크를 흐르는 강으로, 티그리스강과 함께 메소포타미아의 물길을 이룬다.",
    facts: [
      {
        label: "흐름",
        value:
          "티그리스강의 서쪽을 흐르며 이라크 남부에서 두 강이 합쳐져 샤트알아랍강으로 이어진다.",
      },
      {
        label: "농업",
        value:
          "강물을 끌어오는 관개 농업이 유역의 건조한 평야를 경작하는 데 중요하다.",
      },
    ],
    sources: [
      {
        title: "FAO · Irrigation in the Near East region — Turkey",
        url: "https://www.fao.org/4/w4356e/w4356e0w.htm",
      },
      {
        title: "FAO · Irrigation in the Near East region — Iraq",
        url: "https://www.fao.org/4/W4356E/w4356e0e.HTM",
      },
    ],
  },
  {
    names: ["인더스강"],
    definition:
      "티베트 고원에서 시작하여 히말라야 서부와 파키스탄을 지나 아라비아해로 흘러드는 강이다.",
    facts: [
      {
        label: "유역",
        value:
          "카불강과 젤룸강·체나브강 등 여러 지류의 물이 모인다. 본류와 지류가 만드는 넓은 유역을 인더스강 수계라고 한다.",
      },
      {
        label: "농업",
        value:
          "유역의 운하와 관개 시설은 파키스탄의 농업을 지탱한다. 강의 물길과 삼각주는 바다로 이어지는 통로이기도 하다.",
      },
    ],
    sources: [
      {
        title:
          "FAO · The use of irrigation systems for sustainable fish production in Pakistan",
        url: "https://www.fao.org/4/y5082e/y5082e05.htm",
      },
    ],
  },
  {
    names: ["갠지스강"],
    definition:
      "히말라야에서 내려와 인도 북부의 평야를 흐르고 방글라데시를 거쳐 벵골만으로 이어지는 강이다.",
    facts: [
      {
        label: "이름의 시작",
        value:
          "인도 데브프라야그에서 바기라티강과 알라크난다강이 합쳐진 뒤 갠지스강이라는 이름으로 흐른다.",
      },
      {
        label: "생활과 신앙",
        value:
          "넓은 유역의 농업과 생활에 물을 공급하며, 힌두교에서는 신성한 강으로 여겨 순례와 의례가 이루어진다.",
      },
    ],
    sources: [
      {
        title: "인도 National Mission for Clean Ganga · Course of Ganga",
        url: "https://nmcg.nic.in/courseofganga.aspx",
      },
      {
        title:
          "인도 National Mission for Clean Ganga · Ganga — A National River",
        url: "https://www.nmcg.nic.in/ganga_basin.aspx",
      },
    ],
  },
  {
    names: ["황허강", "황허"],
    definition:
      "중국 칭하이의 바옌하르 산지에서 발원하여 황토고원을 지나 보하이해로 들어가는 강이다.",
    facts: [
      {
        label: "황토와 강물",
        value:
          "강물이 황토고원의 고운 흙을 운반하면서 누런빛을 띤다. 하구에 쌓인 퇴적물은 삼각주의 모양을 바꾼다.",
      },
      {
        label: "물길의 변화",
        value:
          "하류는 홍수와 퇴적, 치수 공사로 물길이 여러 차례 달라졌다. 오늘날의 하구를 과거 모든 시대의 하구로 읽으면 안 된다.",
      },
    ],
    sources: [
      {
        title: "NASA Earth Observatory · Building Up the Yellow River Delta",
        url: "https://science.nasa.gov/earth/earth-observatory/building-up-the-yellow-river-delta-148145/",
      },
      {
        title: "NASA Earth Observatory · World of Change: Yellow River Delta",
        url: "https://www.earthobservatory.nasa.gov/Features/WorldOfChange/yellow_river.php",
      },
    ],
  },
  {
    names: ["창장강", "창장", "장강", "양쯔강"],
    definition:
      "중국 내륙에서 동쪽으로 흘러 동중국해로 들어가는 중국에서 가장 긴 강이다. 장강·양쯔강이라고도 부른다.",
    facts: [
      {
        label: "물길",
        value:
          "상류의 진사강은 윈난의 깊은 협곡을 지나며, 중·하류는 중국 동부의 넓은 평야와 도시들을 연결한다.",
      },
      {
        label: "문명",
        value:
          "하류 유역의 량주 유적은 신석기 시대 벼농사와 복잡한 사회 조직을 보여 준다. 중국 고대 문화는 황허 유역뿐 아니라 창장 유역에서도 발달했다.",
      },
    ],
    sources: [
      {
        title: "중국 국무원 · Yangtze River",
        url: "https://english.www.gov.cn/news/202601/05/content_WS695b59a8c6d00ca5f9a0869a.html",
      },
      {
        title: "UNESCO · Three Parallel Rivers of Yunnan Protected Areas",
        url: "https://whc.unesco.org/en/list/1083/",
      },
      {
        title: "UNESCO · Archaeological Ruins of Liangzhu City",
        url: "https://whc.unesco.org/en/list/1592/",
      },
    ],
  },
  {
    names: ["히말라야산맥", "히말라야 산맥"],
    definition:
      "인도 아대륙과 티베트 고원 사이에 솟은 거대한 산맥으로, 세계에서 가장 높은 산들이 모여 있다.",
    facts: [
      {
        label: "형성",
        value:
          "인도판과 유라시아판이 충돌하면서 땅이 밀려 올라가 형성되었다. 두 판의 운동은 지금도 이어진다.",
      },
      {
        label: "지형과 지진",
        value:
          "높은 산줄기는 남아시아와 티베트 사이의 지형적 경계를 이룬다. 판의 충돌이 계속되는 지역이어서 지진 활동도 활발하다.",
      },
    ],
    sources: [
      {
        title: "USGS · The Himalayas: Two continents collide",
        url: "https://pubs.usgs.gov/gip/dynamic/himalaya.html",
      },
      {
        title: "USGS · Seismicity of the Earth — Himalaya and vicinity",
        url: "https://www.usgs.gov/publications/seismicity-earth-1900-2010-himalaya-and-vicinity",
      },
    ],
  },
  {
    names: ["알프스산맥", "알프스 산맥"],
    definition:
      "프랑스에서 스위스·이탈리아·오스트리아를 거쳐 슬로베니아 쪽으로 이어지는 유럽의 큰 산맥이다.",
    facts: [
      {
        label: "여러 나라의 산지",
        value:
          "알프스 지역은 오스트리아·프랑스·독일·이탈리아·리히텐슈타인·모나코·슬로베니아·스위스의 8개 나라에 걸친다.",
      },
      {
        label: "지형",
        value:
          "높은 산과 빙하, 계곡이 이어진다. 이 산악 지역을 함께 보호하기 위해 여러 나라가 알프스 협약에 참여하고 있다.",
      },
    ],
    sources: [
      {
        title: "Alpine Convention · The Alps",
        url: "https://www.alpconv.org/fileadmin/user_upload/Publications/TheAlps.pdf",
      },
      { title: "Alpine Convention", url: "https://www.alpconv.org/en/home/" },
    ],
  },
  {
    names: ["로마"],
    placeIds: ["rome"],
    definition:
      "이탈리아의 티베르강가에 자리한 도시로, 고대 로마 공화정과 제국의 중심지였다.",
    facts: [
      {
        label: "고대 도시",
        value:
          "포룸·콜로세움·판테온 등 공공 공간과 건축물이 고대 도시의 정치·종교·생활을 보여 준다.",
      },
      {
        label: "역사적 변화",
        value:
          "고대 제국의 중심지에서 그리스도교와 교황권의 중심지로 이어졌다. 여러 시대의 유적과 건물이 현재 도시 안에 겹쳐 남아 있다.",
      },
    ],
    sources: [
      {
        title: "UNESCO · Historic Centre of Rome",
        url: "https://whc.unesco.org/en/list/91/",
      },
    ],
  },
  {
    names: ["파리"],
    placeIds: ["paris"],
    definition:
      "프랑스의 센강을 중심으로 발달한 도시로, 강 양쪽에 여러 시대의 정치·종교·문화 공간이 모여 있다.",
    facts: [
      {
        label: "강과 도시",
        value:
          "센강의 시테섬과 양쪽 강변을 따라 도시가 성장했다. 다리와 부두는 도시 내부와 외부를 연결했다.",
      },
      {
        label: "도시의 변화",
        value:
          "노트르담 대성당·루브르·에펠탑은 서로 다른 시대의 모습을 보여 준다. 19세기 오스만의 대로 정비는 이후 여러 도시의 계획에 영향을 주었다.",
      },
    ],
    sources: [
      {
        title: "UNESCO · Paris, Banks of the Seine",
        url: "https://whc.unesco.org/en/list/600/",
      },
    ],
  },
  {
    names: ["베이징"],
    placeIds: ["beijing"],
    definition:
      "중국의 수도이며, 원·명·청을 거치며 궁성과 도성 구조가 발달한 도시다.",
    facts: [
      {
        label: "도시 구조",
        value:
          "남북으로 이어지는 중심축을 따라 궁궐·문·제례 공간이 배치되었다. 중심축의 형성은 원의 대도까지 거슬러 올라간다.",
      },
      {
        label: "장소 구분",
        value:
          "자금성은 베이징 안에 있는 궁궐이다. 베이징이라는 도시와 자금성이라는 건축 유적은 범위가 다르다.",
      },
    ],
    sources: [
      {
        title: "베이징시 · Beijing Info",
        url: "https://english.beijing.gov.cn/beijinginfo/index.html",
      },
      {
        title: "베이징시 · The Past and Present Central Axis",
        url: "https://english.beijing.gov.cn/specials/centralaxis/thepastandpresentcentralaxis/",
      },
    ],
  },
  {
    names: ["콘스탄티노폴리스 · 이스탄불", "이스탄불", "콘스탄티노폴리스"],
    placeIds: ["istanbul"],
    definition:
      "튀르키예의 보스포루스 해협에 자리한 도시로, 유럽과 아시아 및 흑해와 지중해 사이의 교통을 연결한다.",
    facts: [
      {
        label: "역사",
        value:
          "비잔티온과 콘스탄티노폴리스로 알려졌던 옛 시가지는 역사 반도에 있다. 동로마 제국과 오스만 제국의 수도를 거치며 성장했다.",
      },
      {
        label: "도시와 유산",
        value:
          "성벽·하기아 소피아·술레이마니예 모스크 등은 서로 다른 제국과 종교의 역사를 보여 준다. 옛 도성의 범위는 오늘날 이스탄불 전체보다 작다.",
      },
    ],
    sources: [
      {
        title: "UNESCO · Historic Areas of Istanbul",
        url: "https://whc.unesco.org/en/list/356/",
      },
    ],
  },
  {
    names: ["런던"],
    definition:
      "영국의 템스강가에 발달한 도시로, 로마 시대 론디니움에서 도시의 역사가 시작되었다.",
    facts: [
      {
        label: "로마 시대",
        value:
          "1세기 로마인이 세운 론디니움은 항구와 도로가 연결되는 거점이었다. 로마령 브리타니아의 행정 중심지로 성장했다.",
      },
      {
        label: "강과 교역",
        value:
          "바다에서 템스강을 따라 배가 들어올 수 있었고, 강을 건너는 다리가 육상 교통을 연결했다. 이 조건이 항구와 도시의 성장에 중요했다.",
      },
    ],
    sources: [
      {
        title: "London Museum · A timeline of Roman London",
        url: "https://www.londonmuseum.org.uk/collections/london-stories/timeline-roman-london-londinium/",
      },
    ],
  },
  {
    names: ["아테네"],
    placeIds: ["athens"],
    definition:
      "그리스의 도시로, 고대에는 독립적인 도시 국가였으며 민주 정치와 철학·예술이 발달했다.",
    facts: [
      {
        label: "아크로폴리스",
        value:
          "도시 안의 높은 바위 언덕에 있는 성역이다. 아테네라는 도시 전체와 아크로폴리스라는 유적은 서로 구분된다.",
      },
      {
        label: "기원전 5세기",
        value:
          "페르시아 전쟁 이후 페리클레스 시대에 파르테논 신전 등 주요 건축물이 세워졌다. 이 유산들은 고대 아테네의 종교와 정치·예술을 보여 준다.",
      },
    ],
    sources: [
      {
        title: "UNESCO · Acropolis, Athens",
        url: "https://whc.unesco.org/en/list/404/",
      },
    ],
  },
  {
    names: [],
    placeIds: ["yeoncheon"],
    definition:
      "경기도 연천의 구석기 유적으로, 돌의 양쪽 면을 다듬은 주먹도끼가 발견된 곳이다.",
    facts: [
      {
        label: "현재 위치",
        value: "경기 연천 전곡리",
      },
      {
        label: "역사",
        value:
          "전곡리에서 발견된 주먹도끼는 돌의 양면을 다듬어 만든 구석기 도구이다. 사냥과 손질에 쓰인 도구를 통해 당시 사람들이 자연환경에 적응한 방식을 살펴볼 수 있다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 9,
        printedPage: "11",
      },
      {
        sourceId: "atlas-lee",
        pdfPage: 62,
        printedPage: "64",
      },
    ],
  },
  {
    names: [],
    placeIds: ["amsa"],
    definition:
      "서울 강동구에 있는 신석기 시대 마을 유적이다. 움집과 토기 등에서 정착 생활의 모습을 살펴볼 수 있다.",
    facts: [
      {
        label: "현재 위치",
        value: "서울 강동 암사동",
      },
      {
        label: "역사",
        value:
          "암사동은 움집을 짓고 정착한 신석기 사람들의 생활을 살펴볼 수 있는 유적이다. 농경과 어로, 토기 사용은 먹거리를 얻고 저장하는 방식이 달라졌음을 보여 준다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 10,
        printedPage: "12",
      },
    ],
  },
  {
    names: [],
    placeIds: ["pyongyang"],
    definition:
      "대동강 유역에 자리한 도시로, 장수왕 때 고구려의 수도가 되었다.",
    facts: [
      {
        label: "현재 위치",
        value: "평양",
      },
      {
        label: "역사",
        value:
          "장수왕은 수도를 국내성에서 평양으로 옮겨 왕권을 강화하고 남쪽으로 세력을 넓혔다. 대동강 유역의 평야와 바다로 이어지는 교통은 새 수도의 중요한 이점이었다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 25,
        printedPage: "27",
      },
    ],
  },
  {
    names: [],
    placeIds: ["gongju"],
    definition:
      "웅진은 오늘날 충남 공주 지역에 있던 백제의 수도다. 백제가 한성을 잃은 뒤 나라를 다시 정비한 중심지였다.",
    facts: [
      {
        label: "현재 위치",
        value: "충남 공주",
      },
      {
        label: "역사",
        value:
          "한성을 잃은 백제는 웅진으로 수도를 옮긴 뒤 나라를 다시 안정시키려 하였다. 무령왕은 지방 통제를 강화하고 중국 남조와 교류하며 중흥의 기반을 마련하였다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 27,
        printedPage: "29",
      },
    ],
  },
  {
    names: [],
    placeIds: ["buyeo"],
    definition:
      "사비는 오늘날 충남 부여 지역에 있던 백제의 마지막 수도다. 성왕이 이곳으로 천도하여 통치 조직을 정비했다.",
    facts: [
      {
        label: "현재 위치",
        value: "충남 부여",
      },
      {
        label: "역사",
        value:
          "성왕은 넓은 평야와 강을 이용하기 좋은 사비로 수도를 옮기고 통치 조직을 다시 정비하였다. 중국 남조와 교류하고 왜에 불교와 문물을 전하면서 대외 활동도 이어 갔다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 28,
        printedPage: "30",
      },
    ],
  },
  {
    names: [],
    placeIds: ["gimhae"],
    definition:
      "경남에 있는 도시로, 낙동강 하류의 철 생산과 해상 교류를 바탕으로 성장한 금관가야의 중심 지역이다.",
    facts: [
      {
        label: "현재 위치",
        value: "경남 김해",
      },
      {
        label: "역사",
        value:
          "김해의 금관가야는 낙동강 하류의 철 생산과 해상 교통을 바탕으로 초기 가야 연맹을 이끌었다. 낙랑과 왜 등과의 교류는 철기 문화의 성장과 연결되어 있었다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 31,
        printedPage: "33",
      },
    ],
  },
  {
    names: [],
    placeIds: ["gyeongju"],
    definition:
      "금성은 신라의 수도였던 오늘날 경주 지역을 가리키는 이름이다. 통일 신라에서도 나라를 다스리는 중심지였다.",
    facts: [
      {
        label: "현재 위치",
        value: "경북 경주",
      },
      {
        label: "역사",
        value:
          "통일 신라는 금성을 수도로 삼고 전국을 9주와 5소경으로 정비하였다. 5소경은 수도가 동남쪽에 치우친 점을 보완하며 넓어진 나라를 다스리는 역할을 하였다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 56,
        printedPage: "58",
      },
    ],
  },
  {
    names: [],
    placeIds: ["sanggyeong"],
    definition:
      "발해의 수도였던 상경 용천부의 도성 유적이다. 오늘날 중국 닝안 지역에 그 흔적이 남아 있다.",
    facts: [
      {
        label: "현재 위치",
        value: "중국 닝안 지역의 발해 상경성 유적",
      },
      {
        label: "역사",
        value:
          "문왕은 수도를 상경으로 옮기고 통치 제도를 정비하면서 당과의 관계를 개선하였다. 발해는 주변 나라와 교류하며 성장했고 선왕 때 해동성국이라 불릴 만큼 발전하였다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 57,
        printedPage: "59",
      },
    ],
  },
  {
    names: [],
    placeIds: ["wando"],
    definition:
      "장보고가 완도에 설치한 군사·교역 거점이다. 해적을 막고 신라·당·일본을 잇는 바닷길을 지키는 역할을 했다.",
    facts: [
      {
        label: "현재 위치",
        value: "전남 완도 장도 일대",
      },
      {
        label: "역사",
        value:
          "장보고는 완도에 청해진을 설치하여 해적을 소탕하고 바닷길을 확보하였다. 청해진을 중심으로 신라·당·일본을 잇는 해상 무역이 활발하게 이루어졌다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 68,
        printedPage: "70",
      },
    ],
  },
  {
    names: [],
    placeIds: ["kaesong"],
    definition:
      "송악·개경은 오늘날 개성 지역의 역사적 이름이다. 왕건이 수도로 삼은 뒤 고려의 정치 중심지가 되었다.",
    facts: [
      {
        label: "현재 위치",
        value: "개성",
      },
      {
        label: "역사",
        value:
          "왕건은 고려를 세운 이듬해 송악으로 수도를 옮기고 후삼국을 통일하였다. 신라와 후백제뿐 아니라 발해 유민도 받아들이며 여러 세력을 새로운 나라에 통합하였다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 75,
        printedPage: "77",
      },
    ],
  },
  {
    names: [],
    placeIds: ["ganghwa"],
    definition:
      "오늘날 인천에 속하는 섬으로, 몽골의 침입 때 고려 조정이 수도를 옮겨 항전한 곳이다.",
    facts: [
      {
        label: "현재 위치",
        value: "인천 강화",
      },
      {
        label: "역사",
        value:
          "고려 조정은 몽골의 침입에 맞서 수도를 개경에서 강화도로 옮겼다. 농사지을 땅과 거센 물살은 방어에 유리했지만 본토의 백성들은 오랜 전쟁을 겪어야 했다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 91,
        printedPage: "93",
      },
      {
        sourceId: "history2-lee",
        pdfPage: 92,
        printedPage: "94",
      },
    ],
  },
  {
    names: [],
    placeIds: ["jeju"],
    definition:
      "한반도 남쪽의 섬으로, 탐라라는 이름으로도 알려져 있다. 고려 시대에는 삼별초가 마지막으로 항쟁한 무대였다.",
    facts: [
      {
        label: "현재 위치",
        value: "제주",
      },
      {
        label: "역사",
        value:
          "개경 환도에 반대한 삼별초는 진도에 이어 제주도로 옮겨 항쟁을 계속하였다. 고려와 몽골 연합군의 진압은 오랫동안 이어진 대몽 항쟁의 한 국면을 마무리하였다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 92,
        printedPage: "94",
      },
    ],
  },
  {
    names: [],
    placeIds: ["cheongju"],
    definition:
      "충북에 있는 도시로, 고려 시대 흥덕사에서 금속 활자본 직지를 인쇄한 곳이다. 도시 청주와 흥덕사라는 사찰은 구분된다.",
    facts: [
      {
        label: "현재 위치",
        value: "충북 청주",
      },
      {
        label: "역사",
        value:
          "청주 흥덕사에서는 금속 활자로 불교 서적인 직지를 인쇄하였다. 현재 남아 있는 가장 오래된 금속 활자 인쇄본은 고려 인쇄 기술의 높은 수준을 보여 준다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 106,
        printedPage: "108",
      },
    ],
  },
  {
    names: [],
    placeIds: ["seoul"],
    definition:
      "한양은 오늘날 서울에 해당하는 조선의 수도다. 한강의 수운과 주변 산지의 방어 조건을 갖춘 도시였다.",
    facts: [
      {
        label: "현재 위치",
        value: "서울",
      },
      {
        label: "역사",
        value:
          "조선은 건국 뒤 교통과 방어에 유리한 한양으로 수도를 옮겼다. 한강을 이용한 수운과 주변 산지는 새 왕조의 중심 도시를 운영하는 중요한 조건이었다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 113,
        printedPage: "115",
      },
    ],
  },
  {
    names: [],
    placeIds: ["andong"],
    definition:
      "경북에 있는 도시로, 병산 서원 등 조선 시대 사림의 학문과 교육을 보여 주는 유적이 남아 있다.",
    facts: [
      {
        label: "현재 위치",
        value: "경북 안동",
      },
      {
        label: "역사",
        value:
          "안동의 병산 서원은 유성룡과 그의 학문을 기리기 위해 세워진 서원이다. 사당과 강당, 기숙사 배치는 선현을 모시는 일과 학문 교육이 함께 이루어졌음을 보여 준다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 125,
        printedPage: "127",
      },
    ],
  },
  {
    names: [],
    placeIds: ["hansando"],
    definition:
      "경남 통영에 있는 섬으로, 임진왜란 때 이순신의 수군이 승리를 거둔 해전과 관련된 곳이다. 섬의 위치와 해전의 전체 범위는 구분된다.",
    facts: [
      {
        label: "현재 위치",
        value: "경남 통영 한산도 일대",
      },
      {
        label: "역사",
        value:
          "이순신이 이끈 수군은 한산도 등 여러 해전에서 일본군을 무찔렀다. 수군의 승리는 서남해의 바닷길과 곡창 지대를 지키고 일본군의 해상 보급을 막는 데 기여하였다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 133,
        printedPage: "135",
      },
    ],
  },
  {
    names: [],
    placeIds: ["namhansanseong"],
    definition:
      "경기 광주 지역의 산성으로, 병자호란 때 인조와 조선 조정이 청군에 맞서 머문 곳이다.",
    facts: [
      {
        label: "현재 위치",
        value: "경기 광주 남한산성",
      },
      {
        label: "역사",
        value:
          "남한산성에 포위된 조선 조정은 청에 맞설 것인지 화의를 맺을 것인지 논쟁하였다. 구원병의 패배와 강화도 함락 뒤 인조는 삼전도에서 항복했고 많은 사람이 청으로 끌려갔다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 136,
        printedPage: "138",
      },
      {
        sourceId: "history2-lee",
        pdfPage: 137,
        printedPage: "139",
      },
    ],
  },
  {
    names: [],
    placeIds: ["suwon"],
    definition:
      "경기도의 도시로, 정조가 화성을 쌓아 정치·군사·경제 기능을 갖춘 도시로 키우려 했던 곳이다.",
    facts: [
      {
        label: "현재 위치",
        value: "경기 수원",
      },
      {
        label: "역사",
        value:
          "정조는 수원 화성을 정치·군사·경제 기능을 갖춘 도시로 키우려 하였다. 성곽과 시장, 축조에 쓰인 기구는 도시 계획과 당시 과학 기술을 함께 보여 준다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "atlas-lee",
        pdfPage: 91,
        printedPage: "93",
      },
      {
        sourceId: "history2-lee",
        pdfPage: 146,
        printedPage: "148",
      },
    ],
  },
  {
    names: [],
    placeIds: ["jinju"],
    definition:
      "경남의 도시로, 조선 후기 과도한 수탈에 저항한 1862년 농민 봉기의 무대다.",
    facts: [
      {
        label: "현재 위치",
        value: "경남 진주",
      },
      {
        label: "역사",
        value:
          "진주의 농민들은 관리의 과도한 수탈에 맞서 봉기하였다. 저항이 여러 지역으로 퍼져 임술 농민 봉기로 이어지자 정부는 삼정의 폐단을 바로잡으려 하였다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 152,
        printedPage: "154",
      },
    ],
  },
  {
    names: [],
    placeIds: ["busan"],
    definition:
      "한반도 동남쪽의 항구 도시로, 조선 통신사가 일본으로 향하던 해상 교통의 길목이었다.",
    facts: [
      {
        label: "현재 위치",
        value: "부산",
      },
      {
        label: "역사",
        value:
          "부산은 조선 통신사가 일본으로 건너가는 길목에 자리하였다. 사절단은 외교 업무를 수행하면서 일본인들과 글과 학문, 문물을 교류하였다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 155,
        printedPage: "157",
      },
    ],
  },
  {
    names: [],
    placeIds: ["jeonju"],
    definition:
      "전북의 도시로, 1894년 동학 농민군이 전주성을 점령하고 정부와 전주 화약을 맺은 곳이다.",
    facts: [
      {
        label: "현재 위치",
        value: "전북 전주",
      },
      {
        label: "역사",
        value:
          "전주성을 점령한 동학 농민군은 정부와 전주 화약을 맺었다. 농민군은 전라도 각지에 집강소를 두고 부당한 수탈을 줄이는 개혁을 추진하였다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 174,
        printedPage: "176",
      },
    ],
  },
  {
    names: [],
    placeIds: ["daegu"],
    definition:
      "한국의 도시로, 1907년 일본에 진 국채를 국민의 모금으로 갚으려는 국채 보상 운동이 시작된 곳이다.",
    facts: [
      {
        label: "현재 위치",
        value: "대구",
      },
      {
        label: "역사",
        value:
          "대구에서 시작된 국채 보상 운동은 일본에 진 빚을 갚으려는 모금 운동이었다. 외세의 경제 침탈에 대응하려는 움직임이 여러 지역의 시민 참여로 확산되었다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "atlas-lee",
        pdfPage: 104,
        printedPage: "106",
      },
    ],
  },
  {
    names: [],
    placeIds: ["shanghai"],
    definition:
      "중국의 도시로, 1919년 대한민국 임시 정부가 수립되어 독립운동의 거점이 된 곳이다.",
    facts: [
      {
        label: "현재 위치",
        value: "중국 상하이",
      },
      {
        label: "역사",
        value:
          "3·1 운동을 계기로 상하이에 대한민국 임시 정부가 수립되었다. 임시 정부는 국내 연락망과 독립신문, 자금 모집 및 외교 활동을 통해 독립운동을 이어 갔다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 180,
        printedPage: "182",
      },
    ],
  },
  {
    names: [],
    placeIds: ["chongqing"],
    definition:
      "중국의 도시로, 여러 지역을 옮겨 다니던 대한민국 임시 정부가 정착하여 1940년 한국 광복군을 창설한 곳이다.",
    facts: [
      {
        label: "현재 위치",
        value: "중국 충칭",
      },
      {
        label: "역사",
        value:
          "여러 지역을 옮겨 다니던 대한민국 임시 정부는 충칭에 정착하여 한국 광복군을 창설하였다. 태평양 전쟁 뒤에는 연합군의 일원으로 항일 전쟁에 참여하고 국내 진입 작전을 준비하였다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 181,
        printedPage: "183",
      },
    ],
  },
  {
    names: [],
    placeIds: ["gwangju"],
    definition:
      "여기서는 1980년 5·18 민주화 운동이 일어난 광주를 가리킨다. 계엄 철회와 민주주의 회복을 요구한 시민들의 저항이 이어졌다.",
    facts: [
      {
        label: "현재 위치",
        value: "광주",
      },
      {
        label: "역사",
        value:
          "광주의 시민들은 계엄 철회와 민주주의 회복을 요구하며 신군부에 맞섰다. 계엄군의 무력 진압으로 많은 사람이 희생된 5·18 민주화 운동은 한국 민주주의의 중요한 역사로 남았다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 198,
        printedPage: "200",
      },
    ],
  },
  {
    names: [],
    placeIds: ["incheon"],
    definition:
      "한반도 서해안의 항구 도시로, 1950년 인천 상륙 작전이 이루어진 곳이다.",
    facts: [
      {
        label: "현재 위치",
        value: "인천",
      },
      {
        label: "역사",
        value:
          "국군과 유엔군은 인천 상륙 작전에 성공한 뒤 서울을 되찾고 북쪽으로 진격하였다. 이후 중국군의 참전과 후퇴, 정전 협상을 거치며 전쟁은 한반도에 큰 피해와 분단의 상처를 남겼다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 204,
        printedPage: "206",
      },
    ],
  },
  {
    names: [],
    placeIds: ["panmunjom"],
    definition:
      "한반도 군사분계선 일대의 회담 장소로, 2018년 남북 정상이 만나 판문점 선언을 발표한 곳이다.",
    facts: [
      {
        label: "현재 위치",
        value: "한반도 군사분계선의 판문점 일대",
      },
      {
        label: "역사",
        value:
          "남북한 정상은 판문점에서 회담을 열고 판문점 선언을 발표하였다. 이 만남은 대화와 협력으로 평화를 모색한 사례다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history2-lee",
        pdfPage: 207,
        printedPage: "209",
      },
    ],
  },
  {
    names: [],
    placeIds: ["ur"],
    definition:
      "현재 이라크 남부에 유적이 남아 있는 수메르의 도시 국가다. 신전과 지구라트가 도시의 중요한 공간을 차지했다.",
    facts: [
      {
        label: "현재 위치",
        value: "이라크 남부 우르 유적",
      },
      {
        label: "역사",
        value:
          "우르는 수메르인이 메소포타미아에 세운 도시 국가 가운데 하나였다. 도시의 지구라트는 종교와 정치가 긴밀하게 연결된 초기 문명의 모습을 보여 준다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 20,
        printedPage: "22",
      },
    ],
  },
  {
    names: [],
    placeIds: ["giza"],
    definition:
      "이집트의 피라미드 유적이 있는 지역이다. 왕의 무덤인 피라미드와 스핑크스는 고대 이집트의 왕권과 내세관을 보여 준다.",
    facts: [
      {
        label: "현재 위치",
        value: "이집트 기자 지역",
      },
      {
        label: "역사",
        value:
          "기자 지역의 피라미드는 파라오의 강한 권력과 죽은 뒤의 세계에 대한 믿음을 보여 주는 유적이다. 피라미드와 스핑크스, 미라는 이집트인의 내세관이 건축과 생활에 남긴 흔적이다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 21,
        printedPage: "23",
      },
      {
        sourceId: "history1",
        pdfPage: 250,
        printedPage: "253",
      },
    ],
  },
  {
    names: [],
    placeIds: ["mohenjo-daro"],
    definition:
      "현재 파키스탄 신드 지역에 남아 있는 인더스 문명의 도시 유적이다. 계획된 거리와 배수 시설, 공공 목욕 시설이 특징이다.",
    facts: [
      {
        label: "현재 위치",
        value: "파키스탄 신드 지역의 모헨조다로 유적",
      },
      {
        label: "역사",
        value:
          "모헨조다로는 주택과 배수 시설, 목욕탕과 곡물 창고를 갖춘 계획도시였다. 도시 구조와 유물은 인더스 문명의 조직적인 생활과 다른 지역과의 교류를 보여 준다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 23,
        printedPage: "25",
      },
      {
        sourceId: "atlas-2022",
        pdfPage: 15,
        printedPage: "15",
      },
    ],
  },
  {
    names: [],
    placeIds: ["xian"],
    definition:
      "장안은 오늘날 중국 시안 일대에 있던 고대 수도다. 당 시대에는 여러 나라의 사신·유학생·승려가 모이는 국제도시였다.",
    facts: [
      {
        label: "현재 위치",
        value: "중국 시안 일대",
      },
      {
        label: "역사",
        value:
          "당의 수도 장안에는 여러 나라의 사신과 유학생, 승려가 모여들었다. 비단길과 바닷길을 통한 교류는 다양한 종교와 예술이 공존하는 국제적인 문화를 만들었다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 61,
        printedPage: "63",
      },
      {
        sourceId: "atlas-2022",
        pdfPage: 21,
        printedPage: "23",
      },
    ],
  },
  {
    names: [],
    placeIds: ["nara"],
    definition:
      "헤이조쿄는 오늘날 일본 나라 지역에 조성된 8세기의 수도다. 당의 장안성을 본뜬 도시 구조와 큰 불교 사찰이 특징이다.",
    facts: [
      {
        label: "현재 위치",
        value: "일본 나라",
      },
      {
        label: "역사",
        value:
          "일본은 당의 장안성을 본뜬 헤이조쿄로 수도를 옮겨 나라 시대를 열었다. 도다이사 같은 큰 사찰의 건립은 국가 운영과 불교문화가 밀접하게 연결되었음을 보여 준다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 63,
        printedPage: "65",
      },
    ],
  },
  {
    names: [],
    placeIds: ["mecca"],
    definition:
      "사우디아라비아의 도시로, 아라비아 교역로의 거점이자 무함마드가 이슬람교를 전한 곳이다.",
    facts: [
      {
        label: "현재 위치",
        value: "사우디아라비아 메카",
      },
      {
        label: "역사",
        value:
          "메카는 아라비아 교역로의 중심지 가운데 하나였으며 무함마드가 이슬람교를 전한 곳이다. 무함마드는 메디나로 이주한 뒤 세력을 키워 메카를 장악하고 아라비아의 여러 지역을 통합하였다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 67,
        printedPage: "69",
      },
    ],
  },
  {
    names: [],
    placeIds: ["baghdad"],
    definition:
      "이라크에 있는 도시로, 아바스 왕조의 수도였다. 동서 교역을 통해 사람·물산·학문이 모이는 국제도시로 성장했다.",
    facts: [
      {
        label: "현재 위치",
        value: "이라크 바그다드",
      },
      {
        label: "역사",
        value:
          "아바스 왕조의 수도 바그다드는 여러 지역의 사람과 물산이 모이는 국제도시로 성장하였다. 동서 교역과 다양한 문화의 만남은 이슬람 세계의 학문과 경제 발전을 뒷받침하였다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 69,
        printedPage: "71",
      },
      {
        sourceId: "atlas-2022",
        pdfPage: 25,
        printedPage: "27",
      },
    ],
  },
  {
    names: [],
    placeIds: ["kaifeng"],
    definition:
      "송 시대에 화폐 유통과 전문 공연장이 발달하는 등 상업과 서민 문화가 번성했던 중국의 도시다.",
    facts: [
      {
        label: "현재 위치",
        value: "중국 카이펑",
      },
      {
        label: "역사",
        value:
          "카이펑에서는 상업의 성장과 함께 도시 생활이 활발해지고 다양한 공연이 인기를 얻었다. 화폐 유통과 전문 공연장은 경제 발전이 사람들의 일상과 문화까지 바꾸었음을 보여 준다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 94,
        printedPage: "96",
      },
    ],
  },
  {
    names: [],
    placeIds: ["karakorum"],
    definition:
      "오늘날 몽골 하르호린 인근에 남아 있는 몽골 제국의 도시 유적이다. 제국의 여러 지역을 잇는 교통망과 동서 교류의 거점이었다.",
    facts: [
      {
        label: "현재 위치",
        value: "몽골 하르호린 인근의 카라코룸 유적",
      },
      {
        label: "역사",
        value:
          "카라코룸은 몽골 제국의 여러 지역을 연결하는 교통망에 놓여 있었다. 길과 역참을 통한 사람과 물자의 이동은 유라시아의 동서 교류를 확대하였다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "atlas-2022",
        pdfPage: 31,
        printedPage: "33",
      },
    ],
  },
  {
    names: [],
    placeIds: ["agra"],
    definition:
      "인도의 도시로, 무굴 제국 시대에 세워진 타지마할이 있는 곳이다. 도시 아그라와 황후를 기린 건축물 타지마할은 서로 다른 범위의 장소다.",
    facts: [
      {
        label: "현재 위치",
        value: "인도 아그라",
      },
      {
        label: "역사",
        value:
          "아그라의 타지마할은 무굴 황제 샤자한이 황후를 기리기 위해 세운 건축물이다. 연꽃 장식과 돔, 아치의 결합은 인도 고유의 문화와 이슬람 문화가 어우러진 모습을 보여 준다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 115,
        printedPage: "117",
      },
    ],
  },
  {
    names: [],
    placeIds: ["lisbon"],
    definition:
      "포르투갈의 도시로, 아프리카를 돌아 인도로 가는 항해로의 출발점이었다. 동방 물품을 직접 거래하려는 해상 진출과 연결된다.",
    facts: [
      {
        label: "현재 위치",
        value: "포르투갈 리스본",
      },
      {
        label: "역사",
        value:
          "리스본은 포르투갈이 아프리카를 돌아 인도로 나아간 항해로의 출발점이었다. 항해 기술의 발달과 동방 물품을 직접 거래하려는 움직임이 새로운 바닷길 개척을 이끌었다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 117,
        printedPage: "119",
      },
    ],
  },
  {
    names: [],
    placeIds: ["boston"],
    definition:
      "미국의 도시로, 1773년 식민지인들이 영국의 과세에 저항한 보스턴 차 사건이 일어난 항구다.",
    facts: [
      {
        label: "현재 위치",
        value: "미국 보스턴",
      },
      {
        label: "역사",
        value:
          "보스턴에서는 영국의 과세에 반발하는 식민지인들의 보스턴 차 사건이 일어났다. 영국의 항구 봉쇄와 식민지의 저항은 독립 전쟁으로 이어지는 갈등을 키웠다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 132,
        printedPage: "134",
      },
    ],
  },
  {
    names: [],
    placeIds: ["philadelphia"],
    definition:
      "미국의 도시로, 1776년 북아메리카 식민지 대표들이 독립을 선언한 곳이다.",
    facts: [
      {
        label: "현재 위치",
        value: "미국 필라델피아",
      },
      {
        label: "역사",
        value:
          "필라델피아에서 식민지 대표들은 독립을 선언하였다. 자유와 권리, 국민의 동의를 강조한 선언은 새로운 공화국을 세우는 원칙을 제시하였다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 132,
        printedPage: "134",
      },
    ],
  },
  {
    names: [],
    placeIds: ["manchester"],
    definition:
      "영국의 산업 도시다. 19세기 산업화로 공장과 임금 노동이 확대되면서 인구가 크게 늘었다.",
    facts: [
      {
        label: "현재 위치",
        value: "영국 맨체스터",
      },
      {
        label: "역사",
        value:
          "맨체스터는 산업화와 함께 인구가 크게 늘어난 영국의 도시였다. 대규모 공장과 임금 노동의 확대는 농업 중심 사회가 산업 사회로 바뀌는 흐름을 보여 준다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 146,
        printedPage: "148",
      },
    ],
  },
  {
    names: [],
    placeIds: ["wuchang"],
    definition:
      "우창은 오늘날 중국 우한을 이루는 한 지역이다. 1911년 신식 군대의 봉기가 신해혁명으로 이어진 곳이다.",
    facts: [
      {
        label: "현재 위치",
        value: "중국 우한의 우창 지역",
      },
      {
        label: "역사",
        value:
          "우창에서 신식 군대가 봉기하자 여러 지역이 호응하며 청으로부터 독립을 선언하였다. 이 움직임은 중화민국 수립으로 이어졌지만 이후에도 정치적 갈등과 군벌의 성장은 계속되었다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 166,
        printedPage: "168",
      },
    ],
  },
  {
    names: [],
    placeIds: ["tokyo"],
    definition:
      "에도와 도쿄는 같은 도시의 시대별 이름으로, 오늘날 일본 도쿄에 해당한다. 메이지 시대에는 서구 문물의 수용으로 도시 경관과 생활이 변화했다.",
    facts: [
      {
        label: "현재 위치",
        value: "일본 도쿄",
      },
      {
        label: "역사",
        value:
          "메이지 정부는 중앙 집권 체제를 강화하고 교육과 산업 등 여러 분야의 개혁을 추진하였다. 도쿄의 가스등과 벽돌 건물, 마차는 서구 문물의 수용이 도시 생활을 바꾼 모습을 보여 준다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 167,
        printedPage: "169",
      },
    ],
  },
  {
    names: [],
    placeIds: ["sarajevo"],
    definition:
      "보스니아 헤르체고비나의 도시로, 1914년 오스트리아·헝가리 제국의 황태자 부부가 암살된 곳이다.",
    facts: [
      {
        label: "현재 위치",
        value: "보스니아 헤르체고비나 사라예보",
      },
      {
        label: "역사",
        value:
          "사라예보에서 오스트리아·헝가리 제국의 황태자 부부가 암살되었다. 이 사건은 발칸의 민족 갈등과 열강의 동맹 대립 속에서 제1차 세계 대전이 시작되는 계기가 되었다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 177,
        printedPage: "179",
      },
    ],
  },
  {
    names: [],
    placeIds: ["versailles"],
    definition:
      "프랑스의 도시로, 제1차 세계 대전 뒤 연합국과 독일이 베르사유 조약을 맺은 곳이다. 도시와 그 안의 베르사유 궁전은 범위가 다르다.",
    facts: [
      {
        label: "현재 위치",
        value: "프랑스 베르사유",
      },
      {
        label: "역사",
        value:
          "제1차 세계 대전 뒤 연합국과 독일은 베르사유 조약을 맺었다. 독일에 전쟁 책임과 배상 부담을 지운 조약은 전후 국제 질서의 성격과 한계를 보여 준다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 181,
        printedPage: "183",
      },
    ],
  },
  {
    names: [],
    placeIds: ["nanjing"],
    definition:
      "중국의 도시로, 1937년 중일 전쟁 중 일본군이 점령하여 포로와 민간인을 학살한 곳이다.",
    facts: [
      {
        label: "현재 위치",
        value: "중국 난징",
      },
      {
        label: "역사",
        value:
          "중일 전쟁 중 난징을 점령한 일본군은 포로와 민간인들을 학살하였다. 이 사건은 전쟁이 사람들의 생명과 기본적 권리를 어떻게 파괴하는지 보여 준다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 195,
        printedPage: "197",
      },
    ],
  },
  {
    names: [],
    placeIds: ["hiroshima"],
    definition:
      "일본의 도시로, 1945년 제2차 세계 대전 중 원자 폭탄이 투하되어 큰 피해를 입은 곳이다.",
    facts: [
      {
        label: "현재 위치",
        value: "일본 히로시마",
      },
      {
        label: "역사",
        value:
          "히로시마에는 제2차 세계 대전 중 원자 폭탄이 투하되어 많은 사람이 희생되었다. 도시의 피해는 대량 살상 무기와 민간인의 고통을 함께 살피며 평화의 의미를 생각하게 한다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 195,
        printedPage: "197",
      },
    ],
  },
  {
    names: [],
    placeIds: ["bandung"],
    definition:
      "인도네시아의 도시로, 1955년 아시아·아프리카 회의가 열려 평화와 협력의 원칙을 발표한 곳이다.",
    facts: [
      {
        label: "현재 위치",
        value: "인도네시아 반둥",
      },
      {
        label: "역사",
        value:
          "반둥에서는 아시아와 아프리카 29개국 대표가 모여 평화 10원칙을 발표하였다. 제국주의에 반대하고 협력을 강조한 회의는 냉전의 두 진영 밖에서 제3 세계가 목소리를 내는 계기가 되었다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 212,
        printedPage: "214",
      },
    ],
  },
  {
    names: [],
    placeIds: ["berlin"],
    definition:
      "독일의 도시로, 냉전 시대의 분단과 1989년 장벽 붕괴를 상징하는 곳이다. 이듬해 이루어진 독일 통일과 연결된다.",
    facts: [
      {
        label: "현재 위치",
        value: "독일 베를린",
      },
      {
        label: "역사",
        value:
          "1989년 베를린 장벽이 무너지고 이듬해 독일이 통일되었다. 이는 동유럽의 변화와 함께 냉전 체제가 해체되는 과정을 상징하는 사건이다.",
      },
    ],
    sources: [],
    textbookCitations: [
      {
        sourceId: "history1",
        pdfPage: 215,
        printedPage: "217",
      },
    ],
  },
];
