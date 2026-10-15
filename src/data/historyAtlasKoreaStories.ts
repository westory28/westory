import type { AtlasHistoricalStory } from "../lib/historyAtlasStories";
import { ATLAS_DOKDO_ID, ATLAS_DOKDO_LABEL } from "./historyAtlasDokdo";

/** Place-specific historical narratives checked against the linked sources.
 * Broad periods use approximate bounds for sorting, not an asserted event date.
 * Source-map captions are not evidence for an event or a place-to-place edge.
 */
export const koreaHistoricalStories: AtlasHistoricalStory[] = [
  {
    id: "korea-dokdo-imperial-decree",
    subject: "korea",
    placeIds: [ATLAS_DOKDO_ID],
    displayNames: { [ATLAS_DOKDO_ID]: ATLAS_DOKDO_LABEL },
    title: "칙령 제41호로 밝힌 독도 관할",
    period: "1900년",
    startYear: 1900,
    eraIds: ["k-opening"],
    unitId: "korea-modern",
    summary:
      "1900년 10월 25일 대한제국은 칙령 제41호로 울도군의 관할에 석도, 곧 독도를 포함했다. 같은 달 27일 관보에 실린 이 칙령은 독도를 행정구역으로 관리한 사실을 보여 주는 공식 문서이다.",
    sources: [
      {
        title:
          "국사편찬위원회 우리역사넷 · 울릉도와 독도 - 대한제국 칙령 제41호",
        url: "https://contents.history.go.kr/front/hm/view.do?levelId=hm_122_0020",
      },
    ],
  },
  {
    id: "korea-wiman-fall",
    subject: "korea",
    placeIds: ["kr-e8350c00f10a", "kr-bf4a3e8ee3ed"],
    title: "왕검성과 고조선의 마지막 항전",
    period: "기원전 109~108년",
    startYear: -109,
    endYear: -108,
    eraIds: ["k-gojoseon"],
    summary:
      "위만조선은 왕검성을 도읍으로 삼아 성장했다. 한 무제의 공격에 맞서 싸웠지만 기원전 108년 왕검성이 함락되면서 멸망했다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 위만조선",
        url: "https://encykorea.aks.ac.kr/Article/E0041138",
      },
    ],
  },
  {
    id: "korea-buyeo-society",
    subject: "korea",
    placeIds: ["kr-f6864c406d9c"],
    title: "송화강 유역에서 성장한 부여",
    period: "3세기 무렵",
    startYear: 200,
    endYear: 299,
    eraIds: ["k-early-states"],
    summary:
      "부여는 만주 송화강 유역의 평야를 바탕으로 성장한 나라이다. 왕 아래 마가·우가·저가·구가가 각 지역을 다스렸으며, 영고라는 제천 행사를 열었다. 백제의 수도였던 부여(사비)와는 다른 곳이다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 부여",
        url: "https://encykorea.aks.ac.kr/Article/E0024368",
      },
    ],
    replacesEntryIds: ["kr-entry-23a5477ac200"],
  },
  {
    id: "korea-okjeo-society",
    subject: "korea",
    placeIds: ["kr-d8eb25f0c47d"],
    title: "동해안의 읍락 사회, 옥저",
    period: "3세기 무렵",
    startYear: 200,
    endYear: 299,
    eraIds: ["k-early-states"],
    summary:
      "옥저는 함경도 동해안 일대의 여러 읍락으로 이루어졌으며, 큰 왕 없이 읍군·삼로가 지역을 다스렸다. 고구려의 지배를 받으며 해산물 등을 바쳤고, 민며느리제와 가족 공동 무덤의 풍습이 전해진다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 옥저",
        url: "https://encykorea.aks.ac.kr/Article/E0038760",
      },
    ],
    replacesEntryIds: ["kr-entry-2ea53a8b0de5"],
  },
  {
    id: "korea-dongye-society",
    subject: "korea",
    placeIds: ["kr-a252358bb3ed"],
    title: "무천과 책화로 알려진 동예",
    period: "3세기 무렵",
    startYear: 200,
    endYear: 299,
    eraIds: ["k-early-states"],
    summary:
      "동예는 한반도 동해안의 읍락 사회로, 10월에 무천이라는 제천 행사를 열었다. 다른 읍락의 경계를 침범하면 소나 말로 배상하게 하는 책화 풍습은 공동체의 영역을 중시했음을 보여 준다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 동예",
        url: "https://encykorea.aks.ac.kr/Article/E0016693",
      },
    ],
    replacesEntryIds: ["kr-entry-db13e003d308"],
  },
  {
    id: "korea-samhan-society",
    subject: "korea",
    placeIds: ["kr-f01495ac68e6"],
    title: "한반도 중남부의 여러 소국",
    period: "1~3세기",
    startYear: 1,
    endYear: 299,
    eraIds: ["k-early-states"],
    summary:
      "삼한은 마한·진한·변한에 속한 여러 소국을 가리킨다. 농경과 철 생산·교역이 발달했고, 정치 지도자와 별도로 천군이 소도에서 제사를 주관하는 사회였다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 삼한",
        url: "https://encykorea.aks.ac.kr/Article/E0026922",
      },
    ],
  },
  {
    id: "korea-goguryeo-capital",
    subject: "korea",
    placeIds: ["kr-3a00fcea8b71", "pyongyang", "kr-0ee1f40ad364"],
    title: "국내성에서 평양으로 옮긴 고구려",
    period: "427년",
    startYear: 427,
    eraIds: ["k-three-kingdoms"],
    summary:
      "장수왕은 427년 고구려의 수도를 압록강 중류의 국내성에서 평양으로 옮겼다. 평양은 이후 고구려의 정치 중심지가 되었으며 한반도 중부로 세력을 넓히는 거점이 되었다.",
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 국내성 천도",
        url: "https://contents.history.go.kr/mobile/kc/view.do?levelId=kc_i100500",
      },
      {
        title: "한국민족문화대백과사전 · 고구려",
        url: "https://encykorea.aks.ac.kr/Article/E0003323",
      },
    ],
    related: [
      {
        placeId: "kr-0ee1f40ad364",
        reason:
          "평양은 427년 장수왕이 국내성에서 수도를 옮긴 뒤 고구려의 수도가 되었다.",
        fromPlaceIds: ["pyongyang"],
      },
    ],
    replacesEntryIds: ["k-pyongyang", "kr-entry-8d98328439f6"],
  },
  {
    id: "korea-baekje-ungjin",
    subject: "korea",
    placeIds: ["gongju"],
    displayNames: { gongju: "웅진" },
    title: "한성을 잃은 백제의 새 수도",
    period: "475~538년",
    startYear: 475,
    endYear: 538,
    eraIds: ["k-three-kingdoms"],
    summary:
      "475년 고구려의 공격으로 한성이 함락되자 백제는 웅진으로 수도를 옮겼다. 지금의 공주인 웅진에서 왕권과 국가 체제를 다시 정비한 뒤 538년 사비로 천도했다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 백제",
        url: "https://encykorea.aks.ac.kr/Article/E0022355",
      },
    ],
    related: [
      {
        placeId: "buyeo",
        reason: "백제는 538년 수도를 웅진에서 사비로 옮겼다.",
      },
    ],
    replacesEntryIds: ["k-gongju", "kr-entry-635a61e63da7"],
  },
  {
    id: "korea-baekje-sabi",
    subject: "korea",
    placeIds: [
      "buyeo",
      "kr-0e8789fab9e5",
      "kr-9efd660ef7fe",
      "kr-91751bb0167f",
    ],
    displayNames: { buyeo: "사비" },
    title: "성왕의 사비 천도와 백제 재정비",
    period: "538년",
    startYear: 538,
    eraIds: ["k-three-kingdoms"],
    summary:
      "성왕은 538년 수도를 웅진에서 사비로 옮기고 나라 이름을 남부여로 고쳤다. 사비는 백제가 멸망한 660년까지 수도로 기능하며 정치와 불교문화의 중심지가 되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 백제",
        url: "https://encykorea.aks.ac.kr/Article/E0022355",
      },
    ],
    related: [
      {
        placeId: "kr-91751bb0167f",
        reason: "사비는 성왕이 538년에 옮긴 백제의 수도이다.",
        fromPlaceIds: ["buyeo", "kr-0e8789fab9e5"],
      },
    ],
    replacesEntryIds: ["k-buyeo", "kr-entry-fca4acc62c9d"],
  },
  {
    id: "korea-geumgwan-trade",
    subject: "korea",
    placeIds: ["gimhae", "kr-b562ee29531b"],
    title: "철과 바닷길로 성장한 금관가야",
    period: "3세기 후반~532년",
    startYear: 250,
    endYear: 532,
    eraIds: ["k-three-kingdoms"],
    summary:
      "김해의 금관가야는 철 생산과 해상 교역을 바탕으로 성장했다. 낙동강 하류와 바닷길을 잇는 위치 덕분에 주변 나라와 교류했으며, 532년 신라에 통합되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 금관가야",
        url: "https://encykorea.aks.ac.kr/Article/E0007597",
      },
    ],
    related: [
      {
        placeId: "kr-c9f939bfb036",
        reason:
          "김해의 금관가야가 약해진 뒤 고령의 대가야가 후기 가야 세력을 이끌었다.",
        fromPlaceIds: ["gimhae", "kr-b562ee29531b"],
      },
    ],
    replacesEntryIds: ["k-gimhae"],
  },
  {
    id: "korea-daegaya",
    subject: "korea",
    placeIds: ["kr-4970b1122269", "kr-c9f939bfb036"],
    title: "고령을 중심으로 성장한 후기 가야",
    period: "5~6세기",
    startYear: 400,
    endYear: 562,
    eraIds: ["k-three-kingdoms"],
    summary:
      "고령의 대가야는 후기 가야 여러 나라 가운데 중심 세력으로 성장했다. 신라·백제와 경쟁했으나 562년 신라 진흥왕 때 정복되어 가야의 정치 세력이 사라졌다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 대가야",
        url: "https://encykorea.aks.ac.kr/Article/E0013970",
      },
    ],
  },
  {
    id: "korea-gwansan",
    subject: "korea",
    placeIds: ["kr-eccaec67a1fa"],
    title: "백제 성왕이 전사한 관산성 전투",
    period: "554년",
    startYear: 554,
    eraIds: ["k-three-kingdoms"],
    summary:
      "554년 백제와 신라는 지금의 옥천 일대 관산성에서 싸웠다. 이 전투에서 성왕이 전사하고 백제군이 패배하면서 두 나라의 대립이 더욱 깊어졌다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 관산성전투",
        url: "https://encykorea.aks.ac.kr/Article/E0004868",
      },
    ],
    related: [
      {
        placeId: "kr-91751bb0167f",
        reason: "백제 성왕은 554년 관산성 전투에서 신라군과 싸우다 전사했다.",
      },
    ],
  },
  {
    id: "korea-hwangsan",
    subject: "korea",
    placeIds: ["kr-2b733b672c4e"],
    title: "백제의 마지막 방어전",
    period: "660년",
    startYear: 660,
    eraIds: ["k-three-kingdoms"],
    summary:
      "660년 계백이 이끄는 백제군은 황산벌에서 김유신의 신라군에 맞섰으나 패배했다. 신라군은 이후 당군과 합세하여 백제의 수도 사비를 공격했다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 황산벌전투",
        url: "https://encykorea.aks.ac.kr/Article/E0065183",
      },
    ],
    related: [
      {
        placeId: "buyeo",
        reason:
          "황산벌을 돌파한 신라군은 당군과 함께 백제의 수도 사비를 공격했다.",
      },
    ],
  },
  {
    id: "korea-maesoseong",
    subject: "korea",
    placeIds: ["kr-5e04f8bdc885"],
    title: "당의 육군을 막아 낸 신라",
    period: "675년",
    startYear: 675,
    eraIds: ["k-unified-silla"],
    summary:
      "675년 신라는 나당 전쟁 중 매소성에서 당군을 물리쳤다. 백제·고구려를 멸망시킨 뒤 한반도를 직접 지배하려던 당에 맞서 신라가 전쟁의 주도권을 확보한 전투이다. 성의 정확한 위치에는 논의가 남아 있다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 매소성전투",
        url: "https://encykorea.aks.ac.kr/Article/E0017963",
      },
    ],
    related: [
      {
        placeId: "kr-413f9e5bd70a",
        reason:
          "신라는 매소성의 육상 전투에 이어 676년 기벌포의 해전에서도 당군을 물리쳤다.",
      },
    ],
  },
  {
    id: "korea-gibeolpo",
    subject: "korea",
    placeIds: ["kr-413f9e5bd70a"],
    title: "나당 전쟁을 마무리한 해전",
    period: "676년",
    startYear: 676,
    eraIds: ["k-unified-silla"],
    summary:
      "676년 신라 수군은 기벌포에서 당 수군을 격파했다. 일반적으로 금강 하구로 보는 이곳의 승리는 나당 전쟁을 마무리하고 신라의 통합 지배를 굳히는 데 기여했다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 기벌포전투",
        url: "https://encykorea.aks.ac.kr/Article/E0008239",
      },
    ],
  },
  {
    id: "korea-balhae-founded",
    subject: "korea",
    placeIds: ["kr-6c478f7d3a3c", "kr-7e6d4fd4a6ec", "kr-45d624c61b26"],
    title: "대조영이 세운 발해",
    period: "698년",
    startYear: 698,
    eraIds: ["k-balhae", "k-north-south"],
    summary:
      "대조영은 고구려 유민과 말갈 세력을 이끌고 동모산 일대에 나라를 세웠다. 처음 진국이라 불린 이 나라는 뒤에 발해로 불렸으며, 고구려를 잇는 나라로 성장했다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 발해",
        url: "https://encykorea.aks.ac.kr/Article/E0021626",
      },
    ],
    related: [
      {
        placeId: "sanggyeong",
        reason:
          "동모산 일대에서 진국으로 출발한 발해는 뒤에 상경 용천부를 주요 수도로 삼았다.",
        fromPlaceIds: ["kr-6c478f7d3a3c", "kr-7e6d4fd4a6ec", "kr-45d624c61b26"],
      },
    ],
    replacesEntryIds: ["kr-entry-d0a475a274ed", "kr-entry-d80faaedce2e"],
  },
  {
    id: "korea-balhae-sanggyeong",
    subject: "korea",
    placeIds: ["sanggyeong", "kr-7b57cbcdd84d"],
    title: "발해의 주요 수도 상경 용천부",
    period: "8세기 중엽~926년",
    startYear: 750,
    endYear: 926,
    eraIds: ["k-balhae", "k-north-south"],
    summary:
      "발해 문왕은 8세기 중엽 중경에서 상경 용천부로 수도를 옮겼다. 한때 동경으로 천도했으나 성왕 때 다시 돌아왔으며, 상경은 발해가 멸망할 때까지 수도로 기능했다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 상경용천부",
        url: "https://encykorea.aks.ac.kr/Article/E0027003",
      },
    ],
    related: [
      {
        placeId: "kr-6c478f7d3a3c",
        reason:
          "상경 용천부는 발해가 여러 차례 수도를 옮기는 과정에서 가장 오래 중심지가 된 도시이다.",
        fromPlaceIds: ["sanggyeong", "kr-7b57cbcdd84d"],
      },
    ],
    replacesEntryIds: ["k-sanggyeong"],
  },
  {
    id: "korea-cheonghaejin",
    subject: "korea",
    placeIds: ["wando"],
    title: "동아시아 바닷길을 잇던 청해진",
    period: "828~851년",
    startYear: 828,
    endYear: 851,
    eraIds: ["k-unified-silla", "k-north-south"],
    summary:
      "장보고는 828년 완도에 청해진을 설치해 해적을 억제하고 해상 교역을 이끌었다. 신라·당·일본을 잇는 바닷길의 거점이었으며, 장보고 사후인 851년에 폐지되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 청해진",
        url: "https://encykorea.aks.ac.kr/Article/E0056856",
      },
    ],
    replacesEntryIds: ["k-wando", "kr-entry-e34baf6c0a70"],
  },
  {
    id: "korea-cheomseongdae",
    subject: "korea",
    placeIds: ["kr-ab144d954c89"],
    title: "신라 왕경의 천문 관측 시설",
    period: "선덕여왕 재위기(632~647년)",
    startYear: 632,
    endYear: 647,
    eraIds: ["k-three-kingdoms"],
    summary:
      "경주 첨성대는 신라 선덕여왕 때 세운 천문 관측 시설로 전해진다. 하늘의 움직임을 살피고 역법을 운영했던 신라의 과학 지식과 왕경 문화를 보여 준다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 경주 첨성대",
        url: "https://encykorea.aks.ac.kr/Article/E0002925",
      },
    ],
    related: [
      {
        placeId: "gyeongju",
        reason: "첨성대는 신라의 수도 금성, 오늘날의 경주에 세워졌다.",
      },
    ],
  },
  {
    id: "korea-hwangnyongsa",
    subject: "korea",
    placeIds: ["kr-0f463a501d1e", "kr-df6b61435478"],
    title: "불교의 힘으로 나라를 지키려 한 목탑",
    period: "645년",
    startYear: 645,
    eraIds: ["k-three-kingdoms"],
    summary:
      "신라는 선덕여왕 때 자장의 건의로 황룡사 9층 목탑을 세웠다. 이웃 나라의 침입을 막고 나라를 지키려는 호국 불교의 뜻을 담았으며, 백제의 장인 아비지가 건립에 참여했다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 황룡사 구층목탑",
        url: "https://encykorea.aks.ac.kr/Article/E0065127",
      },
    ],
    related: [
      {
        placeId: "gyeongju",
        reason: "황룡사와 그 9층 목탑은 신라의 수도 금성에 있었다.",
        fromPlaceIds: ["kr-0f463a501d1e", "kr-df6b61435478"],
      },
    ],
  },
  {
    id: "korea-seokguram",
    subject: "korea",
    placeIds: ["kr-cf410b097a05"],
    title: "돌로 구현한 통일 신라의 불교 세계",
    period: "8세기",
    startYear: 700,
    endYear: 799,
    eraIds: ["k-unified-silla", "k-north-south"],
    summary:
      "석굴암은 통일 신라 때 토함산에 조성한 인공 석굴 사원이다. 본존불과 여러 조각을 정교하게 배치하여 불교의 이상 세계를 표현했으며, 불국사와 함께 신라의 높은 건축·조각 수준을 보여 준다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 경주 석굴암 석굴",
        url: "https://encykorea.aks.ac.kr/Article/E0028362",
      },
    ],
    related: [
      {
        placeId: "kr-8857f2a66644",
        reason:
          "석굴암과 불국사는 김대성의 발원으로 조성된 통일 신라 불교문화 유산이다.",
      },
    ],
    replacesEntryIds: ["kr-entry-80d95844d913"],
  },
  {
    id: "korea-bulguksa",
    subject: "korea",
    placeIds: ["kr-8857f2a66644", "kr-699f2c61ea69"],
    title: "불국사 석탑과 통일 신라의 불교문화",
    period: "8세기",
    startYear: 700,
    endYear: 799,
    eraIds: ["k-unified-silla", "k-north-south"],
    summary:
      "불국사의 석가탑은 통일 신라의 균형 잡힌 석탑 양식을 보여 준다. 탑 안에서 발견된 무구정광대다라니경은 불교 경전의 간행과 인쇄문화를 살펴볼 수 있는 자료이다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 경주 불국사 삼층석탑",
        url: "https://encykorea.aks.ac.kr/Article/E0024943",
      },
    ],
  },
  {
    id: "korea-hubaekje-capital",
    subject: "korea",
    placeIds: ["jeonju", "kr-ce90dc274922", "kr-27b79a555c30"],
    title: "견훤과 후백제의 중심지 완산",
    period: "900년",
    startYear: 900,
    eraIds: ["k-later-three"],
    summary:
      "견훤은 900년 완산주, 오늘날의 전주를 수도로 삼고 후백제를 본격적으로 키웠다. 전주는 백제 계승을 내세운 후백제의 정치·군사 중심지가 되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 후백제",
        url: "https://encykorea.aks.ac.kr/Article/E0065738",
      },
    ],
    related: [
      {
        placeId: "gwangju",
        reason:
          "후백제를 세운 견훤은 무진주(광주)에서 세력을 키운 뒤 완산주(전주)로 중심지를 옮겼다.",
        fromPlaceIds: ["jeonju", "kr-ce90dc274922", "kr-27b79a555c30"],
      },
    ],
  },
  {
    id: "korea-hugoguryeo-founded",
    subject: "korea",
    placeIds: ["kr-f6857648132f", "kaesong"],
    displayNames: { kaesong: "송악 · 개경" },
    title: "송악에서 후고구려를 세운 궁예",
    period: "901년",
    startYear: 901,
    eraIds: ["k-later-three"],
    summary:
      "궁예는 송악을 근거지로 901년 고구려 계승을 내세운 나라를 세웠다. 역사에서는 왕건의 고려와 구별하여 후고구려라고 부르며, 이후 국호가 마진·태봉으로 바뀌었다.",
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 후고구려의 건국",
        url: "https://contents.history.go.kr/mobile/kc/view.do?levelId=kc_i101600",
      },
    ],
    related: [
      {
        placeId: "kr-8b12d94c5688",
        reason: "후고구려와 태봉은 궁예가 세운 같은 나라의 시기별 이름이다.",
        fromPlaceIds: ["kr-f6857648132f"],
      },
    ],
  },
  {
    id: "korea-cheorwon-capital",
    subject: "korea",
    placeIds: ["kr-5946842fc116", "kr-15f3e3286b78"],
    title: "궁예가 철원으로 수도를 옮기다",
    period: "905년",
    startYear: 905,
    eraIds: ["k-later-three"],
    summary:
      "궁예는 905년 송악에서 철원으로 수도를 옮겼다. 당시 국호는 마진이었으며, 철원은 궁예 정권의 새 정치 중심지가 되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 태봉",
        url: "https://encykorea.aks.ac.kr/Article/E0058942",
      },
    ],
    related: [
      {
        placeId: "kr-f6857648132f",
        reason:
          "궁예가 세운 후고구려는 마진으로 국호를 바꾼 뒤 905년 철원으로 천도했다.",
        fromPlaceIds: ["kr-5946842fc116", "kr-15f3e3286b78"],
      },
      {
        placeId: "kaesong",
        reason: "궁예는 905년 수도를 송악에서 철원으로 옮겼다.",
        fromPlaceIds: ["kr-5946842fc116", "kr-15f3e3286b78"],
      },
    ],
  },
  {
    id: "korea-taebong-renamed",
    subject: "korea",
    placeIds: ["kr-8b12d94c5688", "kr-f6857648132f", "kr-5946842fc116"],
    title: "철원에서 태봉으로 국호를 바꾸다",
    period: "911년",
    startYear: 911,
    eraIds: ["k-later-three"],
    summary:
      "궁예는 철원을 수도로 삼던 911년에 나라 이름을 마진에서 태봉으로 바꾸었다. 후고구려·마진·태봉은 각각 다른 나라가 아니라 궁예 정권이 차례로 사용한 이름이다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 태봉",
        url: "https://encykorea.aks.ac.kr/Article/E0058942",
      },
      {
        title: "국사편찬위원회 한국사데이터베이스 · 태봉으로 국호를 바꾸다",
        url: "https://db.history.go.kr/ancient/level.do?levelId=sg_050_0020_0420",
      },
    ],
    related: [
      {
        placeId: "kr-8b12d94c5688",
        reason: "철원은 궁예가 다스리던 태봉의 수도였다.",
        fromPlaceIds: ["kr-5946842fc116"],
      },
    ],
  },
  {
    id: "korea-goryeo-founded",
    subject: "korea",
    placeIds: ["kr-5946842fc116", "kr-c75537fc787b"],
    title: "철원에서 시작된 고려",
    period: "918년",
    startYear: 918,
    eraIds: ["k-later-three", "k-goryeo"],
    summary:
      "918년 왕건은 궁예를 몰아낸 뒤 철원의 포정전에서 왕위에 올라 고려를 세웠다. 고려가 처음부터 개경에서 시작된 것은 아니며, 수도를 송악으로 옮긴 것은 이듬해이다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 태조",
        url: "https://encykorea.aks.ac.kr/Article/E0059032",
      },
    ],
    related: [
      {
        placeId: "kr-8b12d94c5688",
        reason:
          "918년 철원에서 궁예의 태봉 정권이 무너지고 왕건의 고려가 출범했다.",
        fromPlaceIds: ["kr-5946842fc116", "kr-c75537fc787b"],
      },
      {
        placeId: "kaesong",
        reason: "철원에서 고려를 세운 왕건은 919년 수도를 송악으로 옮겼다.",
        fromPlaceIds: ["kr-5946842fc116", "kr-c75537fc787b"],
      },
    ],
  },
  {
    id: "korea-gaegyeong-capital",
    subject: "korea",
    placeIds: ["kaesong"],
    displayNames: { kaesong: "송악 · 개경" },
    title: "왕건의 송악 천도",
    period: "919년",
    startYear: 919,
    eraIds: ["k-later-three", "k-goryeo"],
    summary:
      "왕건은 919년 자신의 근거지였던 송악으로 수도를 옮겼다. 송악은 고려의 수도 개경으로 발전했으며, 후삼국 통일과 새 왕조의 운영을 이끄는 중심지가 되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 태조",
        url: "https://encykorea.aks.ac.kr/Article/E0059032",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason: "개경은 919년 왕건의 천도 이후 고려의 수도가 되었다.",
      },
    ],
    replacesEntryIds: ["k-kaesong", "kr-entry-76ae91f51f8a"],
  },
  {
    id: "korea-naju-wanggeon",
    subject: "korea",
    placeIds: ["kr-7cf5b0e9787b"],
    title: "왕건이 확보한 서남해의 거점",
    period: "903년",
    startYear: 903,
    eraIds: ["k-later-three"],
    summary:
      "궁예의 장수였던 왕건은 903년 수군을 이끌고 후백제의 금성군을 차지했다. 궁예는 이곳을 나주로 고쳤으며, 나주는 후백제 배후를 견제하는 중요한 해상 거점이 되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 태조",
        url: "https://encykorea.aks.ac.kr/Article/E0059032",
      },
    ],
    related: [
      {
        placeId: "kr-27b79a555c30",
        reason:
          "왕건은 후백제의 금성군을 점령해 나주를 서남해의 군사 거점으로 삼았다.",
      },
    ],
  },
  {
    id: "korea-gongsan-battle",
    subject: "korea",
    placeIds: [
      "kr-e8d498555cf9",
      "kr-ea2e3e94b1b1",
      "kr-18dcdc12b418",
      "daegu",
    ],
    title: "왕건이 크게 패한 공산 전투",
    period: "927년",
    startYear: 927,
    eraIds: ["k-later-three"],
    summary:
      "927년 신라를 구원하러 온 왕건은 대구 팔공산 일대에서 견훤의 후백제군과 싸워 크게 패했다. 신숭겸과 김락 등이 전사했으며, 이후 고려와 후백제의 통일 전쟁이 더욱 치열해졌다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 공산전투",
        url: "https://encykorea.aks.ac.kr/Article/E0004338",
      },
    ],
    related: [
      {
        placeId: "gyeongju",
        reason:
          "927년 후백제가 신라 수도 경주를 공격하자 왕건이 구원에 나섰고, 돌아가는 후백제군과 대구의 공산(팔공산)에서 싸웠다.",
        fromPlaceIds: [
          "kr-e8d498555cf9",
          "kr-ea2e3e94b1b1",
          "kr-18dcdc12b418",
          "daegu",
        ],
      },
    ],
  },
  {
    id: "korea-gochang-battle",
    subject: "korea",
    placeIds: ["andong"],
    displayNames: { andong: "고창(현재 안동)" },
    title: "안동에서 벌어진 고창 전투",
    period: "930년",
    startYear: 930,
    eraIds: ["k-later-three"],
    summary:
      "930년 고려군은 고창, 오늘날의 안동에서 후백제군을 크게 물리쳤다. 이 승리로 고려는 후삼국 경쟁에서 유리해졌으며, 고창군은 안동부로 승격되었다. 전북 고창에서 벌어진 전투가 아니다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 고창전투",
        url: "https://encykorea.aks.ac.kr/Article/E0003996",
      },
    ],
    related: [
      {
        placeId: "kr-27b79a555c30",
        reason: "고려는 930년 안동의 고창 전투에서 후백제의 주력군을 격파했다.",
      },
    ],
  },
  {
    id: "korea-illicheon-battle",
    subject: "korea",
    placeIds: ["kr-c39afafdaf45", "kr-1913669999f4"],
    title: "후삼국 통일을 결정지은 전투",
    period: "936년",
    startYear: 936,
    eraIds: ["k-later-three", "k-goryeo"],
    summary:
      "936년 왕건의 고려군은 지금의 구미 일대 일리천에서 신검의 후백제군을 격파했다. 후백제가 항복하면서 신라의 항복에 이어 후삼국 통일이 마무리되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 일리천전투",
        url: "https://encykorea.aks.ac.kr/Article/E0047180",
      },
    ],
    related: [
      {
        placeId: "kr-27b79a555c30",
        reason:
          "후백제는 936년 구미 일대의 일리천 전투에서 패한 뒤 고려에 항복했다.",
        fromPlaceIds: ["kr-c39afafdaf45", "kr-1913669999f4"],
      },
    ],
  },
  {
    id: "korea-gangdong-six",
    subject: "korea",
    placeIds: ["kr-5abf8c75bf03"],
    title: "서희의 담판과 강동 6주 확보",
    period: "993년 이후",
    startYear: 993,
    endYear: 994,
    eraIds: ["k-goryeo"],
    summary:
      "993년 거란의 침입 때 서희는 소손녕과 협상하여 고려가 압록강 동쪽으로 진출할 근거를 마련했다. 고려는 이듬해부터 여진 세력을 몰아내고 성을 쌓으며 강동 6주를 확보해 갔다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 강동육주",
        url: "https://encykorea.aks.ac.kr/Article/E0001049",
      },
    ],
    related: [
      {
        placeId: "kr-bd065f0d1538",
        reason:
          "귀주는 고려가 거란과 협상한 뒤 확보한 강동 6주 가운데 하나였다.",
      },
    ],
  },
  {
    id: "korea-gwiju",
    subject: "korea",
    placeIds: ["kr-bd065f0d1538", "kr-673a5668c860"],
    title: "거란의 침입을 막아 낸 귀주대첩",
    period: "1019년",
    startYear: 1019,
    eraIds: ["k-goryeo"],
    summary:
      "1019년 강감찬이 이끄는 고려군은 퇴각하던 거란군을 귀주에서 크게 물리쳤다. 이 승리로 거란의 세 번째 침입이 끝났으며, 고려는 국가의 독립과 방어력을 지켜 냈다.",
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 귀주대첩",
        url: "https://contents.history.go.kr/mobile/kc/view.do?levelId=kc_i200400",
      },
    ],
    replacesEntryIds: ["kr-entry-218e816f6fc4"],
  },
  {
    id: "korea-northeast-nine",
    subject: "korea",
    placeIds: ["kr-49c40456dc26"],
    title: "여진 정벌과 성의 설치·반환",
    period: "1107~1109년",
    startYear: 1107,
    endYear: 1109,
    eraIds: ["k-goryeo"],
    summary:
      "윤관은 별무반을 이끌고 여진을 공격한 뒤 동북 변경에 성을 쌓았다. 여진의 반격과 유지의 어려움 때문에 고려는 1109년 성들을 돌려주었다. 각 성의 정확한 위치와 범위에는 학설 차이가 있다.",
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 동북 9성의 위치",
        url: "https://contents.history.go.kr/mobile/hm/view.do?levelId=hm_048_0060",
      },
      {
        title: "한국민족문화대백과사전 · 고려",
        url: "https://encykorea.aks.ac.kr/Article/E0003424",
      },
    ],
  },
  {
    id: "korea-seogyeong-movement",
    subject: "korea",
    placeIds: ["pyongyang"],
    title: "묘청의 서경 천도 운동",
    period: "1135년",
    startYear: 1135,
    eraIds: ["k-goryeo"],
    summary:
      "묘청 등은 개경에서 서경, 오늘날의 평양으로 수도를 옮기고 금에 맞설 것을 주장했다. 주장이 받아들여지지 않자 1135년 서경에서 반란을 일으켰고, 김부식이 이끄는 관군에 진압되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 인종",
        url: "https://encykorea.aks.ac.kr/Article/E0047033",
      },
    ],
    related: [
      {
        placeId: "kaesong",
        reason: "묘청은 고려의 수도를 개경에서 서경으로 옮기자고 주장했다.",
      },
    ],
  },
  {
    id: "korea-ganghwa-capital",
    subject: "korea",
    placeIds: ["ganghwa"],
    title: "몽골에 맞서 수도를 강화도로 옮기다",
    period: "1232~1270년",
    startYear: 1232,
    endYear: 1270,
    eraIds: ["k-goryeo"],
    summary:
      "고려의 무신 정권은 몽골의 침입에 맞서 1232년 수도를 개경에서 강화도로 옮겼다. 강화도는 장기 항전의 정치 중심지가 되었지만, 육지의 백성들은 거듭된 침입으로 큰 피해를 겪었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 삼별초항쟁",
        url: "https://encykorea.aks.ac.kr/Article/E0026605",
      },
    ],
    related: [
      {
        placeId: "kaesong",
        reason:
          "고려 조정은 1232년 개경을 떠나 강화도로 옮겼다가 1270년 개경으로 돌아왔다.",
      },
    ],
    replacesEntryIds: ["k-ganghwa"],
  },
  {
    id: "korea-sambyeolcho-jindo",
    subject: "korea",
    placeIds: ["kr-65f3cf70b9ca"],
    title: "삼별초가 항전의 거점으로 삼은 섬",
    period: "1270~1271년",
    startYear: 1270,
    endYear: 1271,
    eraIds: ["k-goryeo"],
    summary:
      "1270년 개경 환도와 해산 명령에 반대한 삼별초는 강화도에서 진도로 이동했다. 진도를 근거지로 항전했으나 1271년 고려·몽골 연합군의 공격으로 거점을 잃었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 삼별초항쟁",
        url: "https://encykorea.aks.ac.kr/Article/E0026605",
      },
    ],
    related: [
      {
        placeId: "ganghwa",
        reason: "삼별초는 1270년 강화도에서 진도로 이동하여 항전을 이어 갔다.",
      },
      {
        placeId: "jeju",
        reason: "진도 함락 뒤 삼별초의 잔여 세력은 제주도로 이동했다.",
      },
    ],
    replacesEntryIds: ["kr-entry-6bcb4e314837"],
  },
  {
    id: "korea-sambyeolcho-jeju",
    subject: "korea",
    placeIds: ["jeju"],
    title: "삼별초의 마지막 항전지",
    period: "1271~1273년",
    startYear: 1271,
    endYear: 1273,
    eraIds: ["k-goryeo"],
    summary:
      "진도에서 물러난 삼별초는 제주도에서 항전을 이어 갔다. 1273년 고려·몽골 연합군에 진압되면서 삼별초 항쟁이 끝났고, 이후 제주에는 원의 직접적인 지배가 미쳤다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 삼별초항쟁",
        url: "https://encykorea.aks.ac.kr/Article/E0026605",
      },
    ],
    replacesEntryIds: ["k-jeju"],
  },
  {
    id: "korea-jikji",
    subject: "korea",
    placeIds: ["cheongju", "kr-0c579eed7096"],
    title: "흥덕사에서 금속활자로 찍은 직지",
    period: "1377년",
    startYear: 1377,
    eraIds: ["k-goryeo"],
    summary:
      "1377년 청주 흥덕사에서는 백운화상의 가르침을 엮은 직지를 금속활자로 인쇄했다. 현재 전하는 하권은 금속활자로 인쇄한 책 가운데 가장 오래된 것으로 알려져 있다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 직지심체요절 권하",
        url: "https://encykorea.aks.ac.kr/Article/E0071845",
      },
      {
        title: "한국민족문화대백과사전 · 백운화상초록불조직지심체요절",
        url: "https://encykorea.aks.ac.kr/Article/E0022266",
      },
    ],
    replacesEntryIds: ["k-cheongju"],
  },
  {
    id: "korea-wihwado",
    subject: "korea",
    placeIds: ["kr-7d5c72324691"],
    title: "요동 정벌군이 돌아선 위화도",
    period: "1388년",
    startYear: 1388,
    eraIds: ["k-goryeo"],
    summary:
      "이성계 등은 명의 요동을 공격하러 가던 중 압록강의 위화도에서 군사를 돌렸다. 회군한 군대가 우왕을 몰아내고 권력을 장악하면서 고려 말의 정치 질서가 크게 바뀌었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 위화도회군",
        url: "https://encykorea.aks.ac.kr/Article/E0041212",
      },
    ],
    related: [
      {
        placeId: "kaesong",
        reason:
          "위화도에서 회군한 이성계는 고려 수도 개경으로 돌아와 정권을 장악했다.",
      },
    ],
  },
  {
    id: "korea-hanyang",
    subject: "korea",
    placeIds: ["seoul"],
    displayNames: { seoul: "한양" },
    title: "조선의 새 수도 한양",
    period: "1394~1395년",
    startYear: 1394,
    endYear: 1395,
    eraIds: ["k-joseon-early"],
    summary:
      "태조는 1394년 한양으로 수도를 옮겼다. 이듬해 경복궁이 완성되면서 왕궁과 관청을 중심으로 조선의 수도가 갖추어졌다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 경복궁",
        url: "https://encykorea.aks.ac.kr/Article/E0002434",
      },
    ],
    related: [
      {
        placeId: "kr-55eaabde50be",
        reason:
          "한양으로 천도한 조선은 1395년 경복궁을 완성하여 정궁으로 삼았다.",
      },
    ],
    replacesEntryIds: ["k-seoul"],
  },
  {
    id: "korea-gyeongbokgung",
    subject: "korea",
    placeIds: ["kr-55eaabde50be"],
    title: "새 왕조의 중심 궁궐",
    period: "1395년",
    startYear: 1395,
    eraIds: ["k-joseon-early"],
    summary:
      "1395년 완성된 경복궁은 조선의 정궁으로 왕의 생활과 국가 의례·정치가 이루어진 곳이다. 1592년 임진왜란 때 불탄 뒤 오랫동안 복구되지 못했다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 경복궁",
        url: "https://encykorea.aks.ac.kr/Article/E0002434",
      },
    ],
    replacesEntryIds: ["kr-entry-7439f9d5d82e"],
  },
  {
    id: "korea-northern-frontier",
    subject: "korea",
    placeIds: ["kr-31ee5f79f84a", "kr-be8f1454c1ad"],
    title: "세종 때의 북방 개척",
    period: "1430~1440년대",
    startYear: 1430,
    endYear: 1449,
    eraIds: ["k-joseon-early"],
    summary:
      "세종 때 조선은 여진 세력을 정벌하고 압록강 방면에 4군, 두만강 방면에 6진을 설치했다. 성을 쌓는 일과 함께 남쪽 주민을 이주시켜 새 군현의 방어와 생활 기반을 마련했다.",
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 4군 6진 개척",
        url: "https://contents.history.go.kr/mobile/kc/view.do?levelId=kc_i300200",
      },
    ],
  },
  {
    id: "korea-sosu",
    subject: "korea",
    placeIds: ["kr-862bd72c7740", "kr-12ec82766840"],
    title: "국가가 인정한 서원 교육",
    period: "1550년",
    startYear: 1550,
    eraIds: ["k-joseon-early"],
    summary:
      "영주의 백운동서원은 1550년 소수서원이라는 이름과 국가 지원을 받았다. 안향을 기리고 유생을 가르치던 이곳은 조선에서 서원이 확산되는 출발점이 되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 영주 소수서원",
        url: "https://encykorea.aks.ac.kr/Article/E0030146",
      },
    ],
    replacesEntryIds: ["kr-entry-607075d90cbe", "kr-entry-df5918f7d054"],
  },
  {
    id: "korea-dosan",
    subject: "korea",
    placeIds: ["kr-c3b00a1be92c"],
    title: "이황의 학문을 계승한 도산서원",
    period: "1574~1575년",
    startYear: 1574,
    endYear: 1575,
    eraIds: ["k-joseon-early"],
    summary:
      "안동의 도산서원은 이황이 세상을 떠난 뒤인 1574년 제자와 지역 유림이 학문과 덕행을 기리기 위해 세웠다. 1575년 사액을 받아 제향과 유학 교육의 중심지가 되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 안동 도산서원",
        url: "https://encykorea.aks.ac.kr/Article/E0015677",
      },
    ],
    related: [
      {
        placeId: "andong",
        reason:
          "도산서원은 안동에서 이황의 학문을 계승하고 유생을 가르친 서원이다.",
      },
    ],
  },
  {
    id: "korea-byeongsan",
    subject: "korea",
    placeIds: ["kr-b6bcc939acd8", "andong"],
    title: "유성룡의 학문과 덕행을 기린 서원",
    period: "1605~1614년",
    startYear: 1605,
    endYear: 1614,
    eraIds: ["k-joseon-late"],
    summary:
      "임진왜란 뒤 중건된 병산서당은 1605년 서원으로 불리기 시작했다. 유성룡 사후 제자들이 사당을 세우고 1614년 위패를 모시면서 교육과 제향을 함께하는 서원으로 자리 잡았다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 안동 병산서원",
        url: "https://encykorea.aks.ac.kr/Article/E0023102",
      },
    ],
    related: [
      {
        placeId: "andong",
        reason:
          "병산서원은 안동의 풍산 지역 사림과 유성룡의 제자들이 세운 교육·제향 공간이다.",
        fromPlaceIds: ["kr-b6bcc939acd8"],
      },
    ],
    replacesEntryIds: ["k-andong"],
  },
  {
    id: "korea-hansando",
    subject: "korea",
    placeIds: ["hansando"],
    title: "조선 수군의 한산도 승리",
    period: "1592년",
    startYear: 1592,
    eraIds: ["k-joseon-early"],
    summary:
      "1592년 이순신·이억기·원균의 연합 수군은 한산도 앞바다에서 학익진을 펼쳐 일본 수군을 물리쳤다. 이 승리는 일본군의 해상 진출을 막고 조선 수군이 남해의 주도권을 확보하는 데 기여했다.",
    sources: [
      {
        title: "한국학중앙연구원 조선왕조실록사전 · 한산전",
        url: "https://dh.aks.ac.kr/sillokwiki/index.php/한산전(閑山戰)",
      },
    ],
    replacesEntryIds: ["k-hansando"],
  },
  {
    id: "korea-haengju",
    subject: "korea",
    placeIds: ["kr-388386c5b233", "kr-8081f9dbac47"],
    title: "한양 수복을 뒷받침한 행주대첩",
    period: "1593년",
    startYear: 1593,
    eraIds: ["k-joseon-early"],
    summary:
      "1593년 권율이 이끄는 조선군은 행주산성에서 일본군의 공격을 막아 냈다. 한양 가까이에 거점을 둔 이 승리는 도성을 되찾기 위한 조선·명 연합군의 작전에 힘이 되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 행주대첩",
        url: "https://encykorea.aks.ac.kr/Article/E0062859",
      },
    ],
    related: [
      {
        placeId: "seoul",
        reason:
          "권율은 한양을 되찾기 위해 북상하여 행주산성에 진을 치고 일본군을 물리쳤다.",
        fromPlaceIds: ["kr-388386c5b233", "kr-8081f9dbac47"],
      },
    ],
    replacesEntryIds: ["kr-entry-62ca01cae223"],
  },
  {
    id: "korea-myeongnyang",
    subject: "korea",
    placeIds: ["kr-a34472ffacdf"],
    title: "좁은 해협에서 이룬 수군의 승리",
    period: "1597년",
    startYear: 1597,
    eraIds: ["k-joseon-early"],
    summary:
      "이순신은 1597년 명량 해협에서 재정비한 조선 수군을 이끌고 일본 함대를 물리쳤다. 칠천량 패전 뒤 크게 약해졌던 조선 수군이 다시 해상 방어를 이어 갈 수 있었던 전투이다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 해남 명량대첩비",
        url: "https://encykorea.aks.ac.kr/Article/E0018251",
      },
      {
        title: "한국민족문화대백과사전 · 노량해전",
        url: "https://encykorea.aks.ac.kr/Article/E0012716",
      },
    ],
  },
  {
    id: "korea-noryang",
    subject: "korea",
    placeIds: ["kr-f8f6a36df2ea"],
    title: "임진왜란의 마지막 큰 해전",
    period: "1598년",
    startYear: 1598,
    eraIds: ["k-joseon-early"],
    summary:
      "1598년 노량 앞바다에서 이순신과 명의 진린이 이끄는 연합 수군은 철수하려던 일본군과 싸웠다. 조선·명 수군은 승리했으나 이순신이 전사했으며, 임진왜란의 해전도 마무리되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 노량해전",
        url: "https://encykorea.aks.ac.kr/Article/E0012716",
      },
    ],
  },
  {
    id: "korea-namhansanseong",
    subject: "korea",
    placeIds: ["namhansanseong"],
    title: "병자호란 때 인조가 항전한 산성",
    period: "1636~1637년",
    startYear: 1636,
    endYear: 1637,
    eraIds: ["k-joseon-late"],
    summary:
      "청이 침입한 병자호란 때 인조와 조정은 남한산성으로 들어가 항전했다. 성 안에서 청과 싸울지 화친할지를 두고 논쟁이 이어졌지만, 식량 부족과 구원군의 실패로 결국 항복하게 되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 병자호란",
        url: "https://encykorea.aks.ac.kr/Article/E0023151",
      },
      {
        title: "한국민족문화대백과사전 · 남한산성",
        url: "https://encykorea.aks.ac.kr/Article/E0012258",
      },
    ],
    related: [
      {
        placeId: "kr-684290acc045",
        reason:
          "남한산성에서 나온 인조는 1637년 삼전도에서 청 태종에게 항복했다.",
      },
    ],
    replacesEntryIds: ["k-namhansanseong"],
  },
  {
    id: "korea-samjeondo",
    subject: "korea",
    placeIds: ["kr-684290acc045", "kr-6b7944097ae7"],
    title: "병자호란의 항복과 그 기록",
    period: "1637~1639년",
    startYear: 1637,
    endYear: 1639,
    eraIds: ["k-joseon-late"],
    summary:
      "인조는 1637년 삼전도에서 청 태종에게 항복했다. 1639년에는 청의 요구로 삼전도비를 세워 항복의 경위를 기록했으며, 비는 전쟁 뒤 달라진 조선과 청의 관계를 보여 준다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 삼전도",
        url: "https://encykorea.aks.ac.kr/Article/E0026788",
      },
      {
        title: "한국민족문화대백과사전 · 서울 삼전도비",
        url: "https://encykorea.aks.ac.kr/Article/E0026789",
      },
    ],
    replacesEntryIds: ["kr-entry-bb5215dafacd"],
  },
  {
    id: "korea-hwaseong",
    subject: "korea",
    placeIds: ["suwon", "kr-ddd7324d743e"],
    title: "정조가 조성한 계획도시와 성곽",
    period: "1794~1796년",
    startYear: 1794,
    endYear: 1796,
    eraIds: ["k-joseon-late"],
    summary:
      "정조는 1794년부터 1796년까지 수원 화성을 축조했다. 화성은 방어 시설뿐 아니라 행정·상업·생산 기반을 함께 마련한 계획도시로, 조선 후기의 새로운 기술과 도시 구상을 보여 준다.",
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 수원 화성",
        url: "https://contents.history.go.kr/mobile/kc/view.do?levelId=kc_r300890",
      },
      {
        title: "수원시 · 수원 화성",
        url: "https://www.suwon.go.kr/web/tour/cultureTour/cultureTourView.do?categoryCd=119&mstSeqNo=425547",
      },
    ],
    replacesEntryIds: [
      "k-suwon",
      "kr-entry-4f99b478427a",
      "kr-entry-8dccfa5e40aa",
    ],
  },
  {
    id: "korea-dasan",
    subject: "korea",
    placeIds: ["kr-1046bb1f560d", "kr-3f95a0905c94"],
    title: "유배지에서 이어 간 실학 연구",
    period: "1808~1818년",
    startYear: 1808,
    endYear: 1818,
    eraIds: ["k-joseon-late"],
    summary:
      "강진에 유배된 정약용은 1808년 다산초당으로 거처를 옮겨 1818년까지 지냈다. 이곳에서 제자들을 가르치고 목민심서 등을 저술하며 현실의 제도와 백성의 삶을 개선할 방안을 모색했다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 다산초당",
        url: "https://encykorea.aks.ac.kr/Article/E0013467",
      },
    ],
    replacesEntryIds: ["kr-entry-fde51b8271c9"],
  },
  {
    id: "korea-honggyeongnae",
    subject: "korea",
    placeIds: ["kr-c04e08068668", "kr-278bb56d9e1b"],
    title: "홍경래 봉기의 마지막 거점",
    period: "1811~1812년",
    startYear: 1811,
    endYear: 1812,
    eraIds: ["k-joseon-late"],
    summary:
      "1811년 평안도에서 일어난 홍경래의 봉기는 서북 지역 차별과 사회·경제적 불만을 배경으로 했다. 봉기군은 정주성에서 관군에 맞섰으나 1812년 성이 함락되면서 진압되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 홍경래의 난",
        url: "https://encykorea.aks.ac.kr/Article/E0063948",
      },
    ],
  },
  {
    id: "korea-jinju-uprising",
    subject: "korea",
    placeIds: ["jinju"],
    title: "잘못된 세금 운영에 맞선 농민들",
    period: "1862년",
    startYear: 1862,
    eraIds: ["k-joseon-late"],
    summary:
      "1862년 진주에서는 관리의 수탈과 문란한 세금 운영에 저항하는 농민 봉기가 일어났다. 같은 해 여러 지역으로 확산된 임술 농민 봉기는 삼정의 문란과 농민 생활의 위기를 드러냈다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 임술민란",
        url: "https://encykorea.aks.ac.kr/Article/E0047507",
      },
    ],
    replacesEntryIds: ["k-jinju"],
  },
  {
    id: "korea-byeonginyangyo",
    subject: "korea",
    placeIds: ["ganghwa"],
    title: "프랑스군의 강화도 침입",
    period: "1866년",
    startYear: 1866,
    eraIds: ["k-joseon-late"],
    summary:
      "1866년 프랑스는 조선의 천주교 탄압과 프랑스 선교사 처형을 구실로 강화도를 침입했다. 프랑스군은 철수하면서 외규장각 도서 등을 약탈했고, 이 사건은 조선과 서양 세력의 군사 충돌을 보여 준다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 병인양요",
        url: "https://encykorea.aks.ac.kr/Article/E0023142",
      },
    ],
  },
  {
    id: "korea-sinmiyangyo",
    subject: "korea",
    placeIds: ["ganghwa"],
    title: "미국 함대와의 무력 충돌",
    period: "1871년",
    startYear: 1871,
    eraIds: ["k-joseon-late"],
    summary:
      "1871년 미국 함대는 조선에 통상을 요구하며 강화도 일대를 공격했다. 조선군은 광성보 등에서 맞섰고, 미국은 조약을 맺지 못한 채 철수했다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 신미양요",
        url: "https://encykorea.aks.ac.kr/Article/E0032961",
      },
    ],
  },
  {
    id: "korea-ganghwa-treaty",
    subject: "korea",
    placeIds: ["ganghwa"],
    title: "개항의 출발점이 된 불평등 조약",
    period: "1876년",
    startYear: 1876,
    eraIds: ["k-opening"],
    summary:
      "1876년 조선과 일본은 강화도에서 조일수호조규를 맺었다. 이 조약은 조선의 개항을 이끌었지만 일본의 해안 측량권과 영사재판권 등을 인정한 불평등 조약이었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 강화도조약",
        url: "https://encykorea.aks.ac.kr/Article/E0001508",
      },
    ],
    related: [
      {
        placeId: "busan",
        reason: "강화도조약으로 부산을 비롯한 조선의 항구가 일본에 개방되었다.",
      },
    ],
  },
  {
    id: "korea-hwangtohyeon",
    subject: "korea",
    placeIds: ["kr-b5c6da43df96"],
    title: "동학농민군의 첫 큰 승리",
    period: "1894년",
    startYear: 1894,
    eraIds: ["k-opening"],
    summary:
      "1894년 동학농민군은 정읍 황토현에서 전라감영군을 물리쳤다. 이 승리로 농민군은 전라도 각지로 세력을 넓혀 전주성으로 진격할 수 있었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 황토현전투",
        url: "https://encykorea.aks.ac.kr/Article/E0065371",
      },
    ],
    related: [
      {
        placeId: "jeonju",
        reason: "황토현에서 승리한 동학농민군은 세력을 넓혀 전주성을 점령했다.",
      },
    ],
  },
  {
    id: "korea-ugeumchi",
    subject: "korea",
    placeIds: ["kr-07b1b1ab6161", "gongju"],
    displayNames: { gongju: "공주" },
    title: "동학농민군이 맞선 일본군과 관군",
    period: "1894년",
    startYear: 1894,
    eraIds: ["k-opening"],
    summary:
      "1894년 동학농민군은 공주의 우금치에서 일본군과 관군에 맞섰으나 패배했다. 일본의 침략에 저항한 두 번째 봉기가 큰 타격을 입은 전투이다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 우금치전투",
        url: "https://encykorea.aks.ac.kr/Article/E0039816",
      },
    ],
    related: [
      {
        placeId: "kr-b5c6da43df96",
        reason:
          "동학농민군은 황토현에서 승리했지만 같은 해 공주의 우금치에서는 일본군·관군에 패했다.",
        fromPlaceIds: ["kr-07b1b1ab6161", "gongju"],
      },
    ],
  },
  {
    id: "korea-gyeongbokgung-rebuild",
    subject: "korea",
    placeIds: ["kr-55eaabde50be"],
    title: "흥선대원군의 경복궁 중건",
    period: "1865~1867년",
    startYear: 1865,
    endYear: 1867,
    eraIds: ["k-joseon-late"],
    summary:
      "흥선대원군 집권기에 경복궁을 다시 짓는 공사가 진행되어 1867년 완성되었다. 왕실의 권위를 높이려는 사업이었지만, 막대한 비용과 노동 동원은 백성에게 부담이 되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 경복궁",
        url: "https://encykorea.aks.ac.kr/Article/E0002434",
      },
    ],
  },
  {
    id: "korea-independence-gate",
    subject: "korea",
    placeIds: ["kr-f408a789b2b0"],
    title: "자주독립을 상징한 독립문",
    period: "1896~1897년",
    startYear: 1896,
    endYear: 1897,
    eraIds: ["k-opening"],
    summary:
      "독립협회는 청의 사신을 맞던 영은문 자리 가까이에 독립문을 세웠다. 1897년 완성된 독립문은 자주독립과 근대적 개혁을 지향한 움직임을 상징한다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 서울 독립문",
        url: "https://encykorea.aks.ac.kr/Article/E0015980",
      },
    ],
    replacesEntryIds: ["kr-entry-53a9acfcf18f"],
  },
  {
    id: "korea-agwan",
    subject: "korea",
    placeIds: ["kr-2261bcc0d80e", "seoul"],
    displayNames: { seoul: "서울" },
    title: "고종이 러시아 공사관으로 거처를 옮기다",
    period: "1896~1897년",
    startYear: 1896,
    endYear: 1897,
    eraIds: ["k-opening"],
    summary:
      "을미사변 뒤 신변에 위협을 느낀 고종은 1896년 러시아 공사관으로 피신했다. 약 1년간 공사관에서 국정을 운영한 아관파천은 열강의 영향력이 커지던 당시의 위기를 보여 준다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 아관파천",
        url: "https://encykorea.aks.ac.kr/Article/E0034214",
      },
    ],
    related: [
      {
        placeId: "kr-18b733ab896a",
        reason:
          "러시아 공사관에 머물던 고종은 1897년 경운궁, 오늘날의 덕수궁으로 돌아왔다.",
        fromPlaceIds: ["kr-2261bcc0d80e"],
      },
    ],
  },
  {
    id: "korea-daehan-empire",
    subject: "korea",
    placeIds: ["kr-50dba735c9cb", "kr-18b733ab896a", "seoul"],
    displayNames: { seoul: "서울" },
    title: "황제국을 선포한 대한제국",
    period: "1897년",
    startYear: 1897,
    eraIds: ["k-opening"],
    summary:
      "고종은 1897년 환구단에서 황제 즉위 의례를 거행하고 대한제국을 선포했다. 경운궁, 오늘날의 덕수궁을 중심으로 자주적인 황제국의 위상을 세우고 근대화를 추진하고자 했다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 대한제국",
        url: "https://encykorea.aks.ac.kr/Article/E0015187",
      },
    ],
  },
  {
    id: "korea-haag",
    subject: "korea",
    placeIds: ["kr-caf0272950d9"],
    title: "외교권 침탈을 알리려 한 특사들",
    period: "1907년",
    startYear: 1907,
    eraIds: ["k-opening"],
    summary:
      "고종이 보낸 이준·이상설·이위종은 1907년 헤이그 만국평화회의에서 일본의 외교권 침탈을 알리고자 했다. 공식 회의 참석은 막혔지만 국제 여론에 한국의 처지를 호소했다.",
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 헤이그 특사 파견",
        url: "https://contents.history.go.kr/mobile/kc/view.do?levelId=kc_i403600",
      },
    ],
  },
  {
    id: "korea-debt-repayment",
    subject: "korea",
    placeIds: ["daegu"],
    title: "나라의 빚을 갚아 국권을 지키려 한 운동",
    period: "1907~1908년",
    startYear: 1907,
    endYear: 1908,
    eraIds: ["k-opening"],
    summary:
      "1907년 대구에서 시작된 국채보상운동은 국민의 모금으로 일본에 진 빚을 갚아 국권을 지키려는 운동이었다. 금연과 절약, 패물 기부 등으로 전국의 다양한 계층이 참여했다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 국채보상운동",
        url: "https://encykorea.aks.ac.kr/Article/E0006527",
      },
    ],
    replacesEntryIds: ["k-daegu"],
  },
  {
    id: "korea-harbin",
    subject: "korea",
    placeIds: ["kr-da2cc50b7f4d", "kr-c1ed0cb64ada"],
    title: "안중근이 이토 히로부미를 처단하다",
    period: "1909년",
    startYear: 1909,
    eraIds: ["k-opening"],
    summary:
      "1909년 10월 26일 안중근은 하얼빈역에서 이토 히로부미를 저격했다. 한국의 국권 침탈에 책임이 있는 인물을 처단하고 한국의 독립과 동양 평화의 뜻을 알린 의거였다.",
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 안중근",
        url: "https://contents.history.go.kr/mobile/kc/view.do?levelId=kc_n402100",
      },
    ],
  },
  {
    id: "korea-myeongdong-school",
    subject: "korea",
    placeIds: ["kr-0cc563fa13e0"],
    title: "북간도 민족교육의 거점",
    period: "1909년 개편, 이후 일제 강점기까지",
    startYear: 1909,
    eraIds: ["k-opening", "k-colonial"],
    summary:
      "1908년 명동서숙으로 출발한 교육기관은 이듬해 명동학교로 개편되었다. 북간도 한인 사회에서 민족의식을 기르고 새로운 교육을 펼쳐 독립운동의 인적 기반을 키웠다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 명동학교",
        url: "https://encykorea.aks.ac.kr/Article/E0018242",
      },
    ],
  },
  {
    id: "korea-sinheung-training",
    subject: "korea",
    placeIds: ["kr-fb19b083a7da", "kr-16595e6c7c89"],
    title: "서간도에서 독립운동의 인재를 기르다",
    period: "1911년",
    startYear: 1911,
    eraIds: ["k-colonial"],
    summary:
      "이회영 등은 서간도 삼원보에 한인 자치 조직을 만들고 신흥강습소를 설립했다. 교육과 군사 훈련으로 독립운동 인재를 길렀으며, 뒤에 신흥무관학교로 발전하는 기반이 되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 신흥무관학교",
        url: "https://encykorea.aks.ac.kr/Article/E0033613",
      },
    ],
    related: [
      {
        placeId: "kr-a3ba62f3bf41",
        reason:
          "삼원보의 신흥강습소는 이후 신흥무관학교로 발전한 독립군 교육기관의 출발점이다.",
        fromPlaceIds: ["kr-fb19b083a7da", "kr-16595e6c7c89"],
      },
    ],
  },
  {
    id: "korea-sinheung-military",
    subject: "korea",
    placeIds: ["kr-a3ba62f3bf41"],
    title: "독립군 간부를 양성한 학교",
    period: "1919~1920년",
    startYear: 1919,
    endYear: 1920,
    eraIds: ["k-colonial"],
    summary:
      "1919년 신흥무관학교라는 이름으로 개편된 학교는 만주에서 독립군 간부를 양성했다. 졸업생들은 여러 독립군 부대에 참여하여 항일 무장 투쟁을 이어 갔다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 신흥무관학교",
        url: "https://encykorea.aks.ac.kr/Article/E0033613",
      },
    ],
  },
  {
    id: "korea-march-first",
    subject: "korea",
    placeIds: ["kr-617d98ea0194", "seoul"],
    displayNames: { seoul: "서울" },
    title: "독립선언을 듣고 거리로 나선 사람들",
    period: "1919년 3월 1일",
    startYear: 1919,
    eraIds: ["k-colonial"],
    summary:
      "1919년 3월 1일 탑골공원에 모인 학생과 시민들은 독립선언서를 낭독하고 거리에서 만세를 외쳤다. 서울과 여러 도시에서 시작된 시위는 전국과 국외 한인 사회로 퍼졌다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 3·1운동",
        url: "https://encykorea.aks.ac.kr/Article/E0026772",
      },
    ],
    related: [
      {
        placeId: "shanghai",
        reason:
          "서울 등지에서 시작된 3·1운동은 상하이의 대한민국 임시정부 수립에 중요한 계기가 되었다.",
        fromPlaceIds: ["seoul"],
      },
    ],
    replacesEntryIds: ["kr-entry-4c49855530c7"],
  },
  {
    id: "korea-jeamri",
    subject: "korea",
    placeIds: ["kr-fca84e37de49", "kr-2644d14725ef"],
    title: "3·1운동을 탄압한 제암리 학살",
    period: "1919년 4월 15일",
    startYear: 1919,
    eraIds: ["k-colonial"],
    summary:
      "1919년 4월 15일 일본군은 제암리 주민을 교회에 모아 살해하고 마을에 불을 질렀다. 화성 지역 만세운동에 대한 이 폭력적 탄압은 선교사 등의 조사와 기록으로 국내외에 알려졌다.",
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 제암리 학살의 현장",
        url: "https://contents.history.go.kr/mobile/hm/view.do?levelId=hm_123_0090",
      },
    ],
    replacesEntryIds: ["kr-entry-ab7f99cac852", "kr-entry-deb0b3007c3f"],
  },
  {
    id: "korea-provisional-government",
    subject: "korea",
    placeIds: ["shanghai"],
    title: "민주공화국을 지향한 임시정부",
    period: "1919년 4월",
    startYear: 1919,
    eraIds: ["k-colonial"],
    summary:
      "1919년 4월 11일 상하이에서 대한민국 임시헌장이 반포되고 대한민국 임시정부가 수립되었다. 임시정부는 군주국이 아닌 민주공화국의 독립 국가를 세우려 했다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 대한민국 임시정부",
        url: "https://encykorea.aks.ac.kr/Article/E0015017",
      },
    ],
    related: [
      {
        placeId: "chongqing",
        reason:
          "상하이에서 출발한 대한민국 임시정부는 일본의 압박을 피해 이동한 끝에 충칭에 정착했다.",
      },
    ],
    replacesEntryIds: ["k-shanghai"],
  },
  {
    id: "korea-bongo",
    subject: "korea",
    placeIds: ["kr-75f4f7846e38"],
    title: "독립군 연합부대의 승리",
    period: "1920년 6월",
    startYear: 1920,
    eraIds: ["k-colonial"],
    summary:
      "1920년 6월 홍범도·최진동 등이 이끄는 독립군은 봉오동의 지형을 이용해 일본군을 물리쳤다. 여러 독립군 부대의 협력과 전술이 큰 성과를 낸 전투였다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 봉오동전투",
        url: "https://encykorea.aks.ac.kr/Article/E0023974",
      },
    ],
    related: [
      {
        placeId: "kr-c63040039435",
        reason:
          "봉오동 전투에 참여한 홍범도의 독립군은 같은 해 청산리 일대 전투에서도 일본군과 싸웠다.",
      },
    ],
    replacesEntryIds: ["kr-entry-4982c5e7a104"],
  },
  {
    id: "korea-cheongsanri",
    subject: "korea",
    placeIds: ["kr-c63040039435"],
    title: "만주 독립군이 벌인 연속 전투",
    period: "1920년 10월",
    startYear: 1920,
    eraIds: ["k-colonial"],
    summary:
      "1920년 10월 김좌진의 북로군정서군과 홍범도 부대 등은 청산리 일대에서 일본군과 여러 차례 싸워 승리했다. 한 장소의 단일 전투가 아니라 여러 독립군 부대가 벌인 연속된 전투였다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 청산리대첩",
        url: "https://encykorea.aks.ac.kr/Article/E0056468",
      },
    ],
    replacesEntryIds: ["kr-entry-f97aa7213138"],
  },
  {
    id: "korea-free-city",
    subject: "korea",
    placeIds: ["kr-ee70c94cb8ae"],
    title: "독립군이 큰 피해를 입은 자유시 참변",
    period: "1921년",
    startYear: 1921,
    eraIds: ["k-colonial"],
    summary:
      "1921년 러시아 자유시, 오늘날의 스보보드니에서 독립군 부대의 지휘권과 무장 통합을 둘러싼 갈등이 충돌로 이어졌다. 러시아 적군의 공격으로 한인 독립군이 큰 피해를 입었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 자유시사변",
        url: "https://encykorea.aks.ac.kr/Article/E0072193",
      },
    ],
    replacesEntryIds: ["kr-entry-1395b5ab1df1", "kr-entry-17f0351d723e"],
  },
  {
    id: "korea-products",
    subject: "korea",
    placeIds: ["pyongyang"],
    title: "우리 물건을 쓰자는 물산장려운동",
    period: "1920년대",
    startYear: 1920,
    endYear: 1929,
    eraIds: ["k-colonial"],
    summary:
      "평양에서는 조만식 등을 중심으로 조선 물산을 쓰고 생산을 늘리자는 운동이 추진되었다. 물산장려운동은 일본 상품에 맞서 민족 경제를 지키려 했으며, 이후 전국으로 확산되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 조선물산장려운동",
        url: "https://encykorea.aks.ac.kr/Article/E0052020",
      },
    ],
  },
  {
    id: "korea-june-tenth",
    subject: "korea",
    placeIds: ["seoul"],
    displayNames: { seoul: "서울" },
    title: "순종의 장례를 계기로 펼친 만세운동",
    period: "1926년 6월 10일",
    startYear: 1926,
    eraIds: ["k-colonial"],
    summary:
      "1926년 순종의 장례 행렬이 지나던 서울 거리에서 학생들이 독립 만세를 외쳤다. 6·10만세운동은 식민 통치에 저항한 학생 중심의 항일운동이었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 6·10만세운동",
        url: "https://encykorea.aks.ac.kr/Article/E0042124",
      },
    ],
  },
  {
    id: "korea-wonsan-strike",
    subject: "korea",
    placeIds: ["kr-f264380b68d2"],
    title: "노동자들이 연대한 원산 총파업",
    period: "1929년 1~4월",
    startYear: 1929,
    eraIds: ["k-colonial"],
    summary:
      "1929년 원산 노동자들은 일본인 감독의 폭행과 노동 탄압에 맞서 총파업을 벌였다. 여러 직종의 노동자와 국내외 노동단체가 연대했지만, 식민 당국과 자본가의 탄압으로 파업은 끝났다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 원산총파업",
        url: "https://encykorea.aks.ac.kr/Article/E0040696",
      },
    ],
  },
  {
    id: "korea-gwangju-students",
    subject: "korea",
    placeIds: ["gwangju", "kr-7cf5b0e9787b"],
    title: "민족 차별에 항거한 학생들",
    period: "1929~1930년",
    startYear: 1929,
    endYear: 1930,
    eraIds: ["k-colonial"],
    summary:
      "나주역에서 발생한 한일 학생 간 충돌과 식민지의 민족 차별에 대한 분노는 1929년 11월 광주의 항일 시위로 이어졌다. 학생들은 차별 교육의 철폐와 독립을 요구했고 운동은 전국으로 확산되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 광주학생운동",
        url: "https://encykorea.aks.ac.kr/Article/E0005301",
      },
    ],
    replacesEntryIds: ["kr-entry-936c89c3ddc7"],
  },
  {
    id: "korea-yun-bonggil",
    subject: "korea",
    placeIds: ["shanghai"],
    title: "상하이 훙커우공원에서의 윤봉길 의거",
    period: "1932년",
    startYear: 1932,
    eraIds: ["k-colonial"],
    summary:
      "1932년 윤봉길은 상하이 훙커우공원에서 열린 일본의 전승 기념 행사에 폭탄을 던졌다. 의거는 한국 독립운동의 의지를 알렸고, 중국이 대한민국 임시정부를 지원하는 데 영향을 주었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 윤봉길",
        url: "https://encykorea.aks.ac.kr/Article/E0042345",
      },
    ],
  },
  {
    id: "korea-liberation-army",
    subject: "korea",
    placeIds: ["chongqing"],
    title: "임시정부의 군대, 한국광복군",
    period: "1940년",
    startYear: 1940,
    eraIds: ["k-colonial"],
    summary:
      "대한민국 임시정부는 충칭에 정착한 뒤 1940년 한국광복군을 창설했다. 광복군은 일본에 맞선 독립 전쟁을 준비하며 중국 등 연합국 측과 협력했다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 한국광복군",
        url: "https://encykorea.aks.ac.kr/Article/E0005134",
      },
    ],
    replacesEntryIds: ["k-chongqing"],
  },
  {
    id: "korea-jeju-april-third",
    subject: "korea",
    placeIds: ["jeju"],
    title: "제주4·3과 민간인의 희생",
    period: "1947~1954년",
    startYear: 1947,
    endYear: 1954,
    eraIds: ["k-modern"],
    summary:
      "제주4·3은 1947년 3·1절 발포 사건 이후의 갈등, 1948년 무장봉기와 진압 과정에서 수많은 주민이 희생된 사건이다. 제주 현대사를 이해할 때 국가폭력과 민간인 피해, 진상 규명과 화해의 과정을 함께 살펴야 한다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 제주4·3사건",
        url: "https://encykorea.aks.ac.kr/Article/E0051439",
      },
    ],
    replacesEntryIds: ["kr-entry-839a3c50b260"],
  },
  {
    id: "korea-incheon-landing",
    subject: "korea",
    placeIds: ["incheon"],
    title: "전쟁의 흐름을 바꾼 상륙작전",
    period: "1950년 9월 15일",
    startYear: 1950,
    eraIds: ["k-modern"],
    summary:
      "1950년 9월 15일 유엔군은 인천에 상륙하여 북한군의 후방을 공격했다. 상륙작전은 낙동강 전선의 반격과 서울 수복으로 이어져 6·25전쟁의 전황을 바꾸었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 인천상륙작전",
        url: "https://encykorea.aks.ac.kr/Article/E0047085",
      },
    ],
    related: [
      {
        placeId: "seoul",
        reason: "인천상륙작전 이후 유엔군과 국군은 서울을 수복했다.",
      },
    ],
    replacesEntryIds: ["k-incheon", "kr-entry-08abf9387e0e"],
  },
  {
    id: "korea-armistice",
    subject: "korea",
    placeIds: ["panmunjom"],
    title: "전투를 멈춘 정전협정",
    period: "1953년 7월 27일",
    startYear: 1953,
    eraIds: ["k-modern"],
    summary:
      "1953년 판문점에서 유엔군 측과 북한군·중국인민지원군 측이 정전협정에 서명했다. 협정은 전투를 중지시키고 군사분계선과 비무장지대를 정했지만, 평화조약으로 전쟁을 끝낸 것은 아니었다.",
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 6·25전쟁 정전협정",
        url: "https://contents.history.go.kr/mobile/kc/view.do?levelId=kc_i502950",
      },
    ],
  },
  {
    id: "korea-masan-march",
    subject: "korea",
    placeIds: ["kr-bb028743fdca"],
    title: "부정선거에 항의한 3·15의거",
    period: "1960년 3~4월",
    startYear: 1960,
    eraIds: ["k-modern"],
    summary:
      "1960년 3월 15일 마산 시민들은 부정선거에 항의하여 시위했다. 경찰의 강경 진압 뒤 김주열의 시신이 발견되면서 분노가 확산되었고, 4·19혁명으로 이어지는 중요한 계기가 되었다.",
    sources: [
      {
        title: "민주화운동기념사업회 · 3.15마산의거",
        url: "https://dict.kdemo.or.kr/entry/84/",
      },
      {
        title: "한국민족문화대백과사전 · 4·19혁명",
        url: "https://encykorea.aks.ac.kr/Article/E0025902",
      },
    ],
    related: [
      {
        placeId: "seoul",
        reason:
          "마산의 3·15의거와 김주열의 죽음은 서울을 비롯한 전국의 4·19혁명에 영향을 주었다.",
      },
    ],
  },
  {
    id: "korea-april-revolution",
    subject: "korea",
    placeIds: ["seoul"],
    displayNames: { seoul: "서울" },
    title: "독재와 부정선거에 맞선 4·19혁명",
    period: "1960년 4월",
    startYear: 1960,
    eraIds: ["k-modern"],
    summary:
      "1960년 4월 서울과 전국의 학생·시민들은 부정선거와 이승만 정권에 항의했다. 경찰의 발포로 많은 희생자가 나왔지만 시위는 계속되었고, 결국 이승만이 대통령직에서 물러났다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 4·19혁명",
        url: "https://encykorea.aks.ac.kr/Article/E0025902",
      },
    ],
  },
  {
    id: "korea-buma",
    subject: "korea",
    placeIds: ["busan", "kr-bb028743fdca"],
    title: "유신체제에 맞선 부산·마산 시민들",
    period: "1979년 10월",
    startYear: 1979,
    eraIds: ["k-modern"],
    summary:
      "1979년 10월 부산과 마산에서 학생과 시민들이 유신체제에 반대하는 시위를 벌였다. 정부는 계엄과 위수령으로 진압했으며, 부마민주항쟁은 유신체제가 흔들리는 중요한 계기가 되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 부마민주항쟁",
        url: "https://encykorea.aks.ac.kr/Article/E0024157",
      },
    ],
    replacesEntryIds: ["kr-entry-c42dc43d43e5"],
  },
  {
    id: "korea-gwangju-may",
    subject: "korea",
    placeIds: ["gwangju"],
    title: "민주주의를 지키려 한 5·18민주화운동",
    period: "1980년 5월 18~27일",
    startYear: 1980,
    eraIds: ["k-modern"],
    summary:
      "1980년 5월 광주 시민과 학생들은 신군부의 비상계엄 확대와 폭력적인 진압에 저항했다. 계엄군의 발포와 무력 진압으로 많은 사람이 희생되었으며, 진상 규명과 민주주의를 위한 요구가 계속되었다.",
    sources: [
      {
        title:
          "국사편찬위원회 우리역사넷 · 5·18 민주화 운동시 광주 시민 궐기문",
        url: "https://contents.history.go.kr/mobile/hm/view.do?levelId=hm_151_0010",
      },
    ],
    replacesEntryIds: ["k-gwangju", "kr-entry-70106af112bd"],
  },
  {
    id: "korea-june-democracy",
    subject: "korea",
    placeIds: ["kr-08bd6fdf1ad4", "seoul"],
    displayNames: { seoul: "서울" },
    title: "대통령 직선제를 요구한 6월민주항쟁",
    period: "1987년 6월",
    startYear: 1987,
    eraIds: ["k-modern"],
    summary:
      "1987년 6월 서울과 전국에서 시민들은 고문치사 사건의 진상 규명과 대통령 직선제 개헌을 요구했다. 명동성당은 시위대가 농성한 주요 장소였으며, 전국적인 항쟁은 직선제 개헌을 이끌었다.",
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 6월 민주 항쟁",
        url: "https://contents.history.go.kr/mobile/eh/view.do?levelId=eh_r0420_0010",
      },
    ],
  },
  {
    id: "korea-panmunjom-summit",
    subject: "korea",
    placeIds: ["panmunjom"],
    title: "군사분계선을 넘어 만난 남북 정상",
    period: "2018년 4월 27일",
    startYear: 2018,
    eraIds: ["k-modern"],
    summary:
      "2018년 4월 27일 남북 정상은 판문점에서 만나 군사적 긴장 완화와 한반도 평화 정착을 논의했다. 회담 뒤 발표한 판문점선언에는 남북 관계 개선과 평화체제 구축을 추진한다는 내용이 담겼다.",
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 남북 정상 회담",
        url: "https://contents.history.go.kr/mobile/eh/view.do?levelId=eh_r0391_0010",
      },
    ],
    replacesEntryIds: ["k-panmunjom"],
  },
  {
    id: "korea-yeoncheon",
    subject: "korea",
    placeIds: ["yeoncheon"],
    title: "주먹도끼로 읽는 구석기인의 생활",
    period: "구석기 시대(약 30만 년 전 무렵)",
    startYear: -300000,
    eraIds: ["k-prehistory"],
    summary:
      "전곡리에서는 돌의 양쪽 면을 다듬어 만든 주먹도끼를 비롯한 구석기 도구가 발견되었다. 이 발견은 동아시아에 주먹도끼 문화가 없다는 기존 학설을 바꾸는 중요한 계기가 되었다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 연천 전곡리 유적",
        url: "https://encykorea.aks.ac.kr/Article/E0049243",
      },
      {
        title: "경기도 · 연천 전곡리 유적의 구석기 문화",
        url: "https://gnews.gg.go.kr/news/news_detail.do?number=202505111519094247C076&s_code=C076",
      },
    ],
    replacesEntryIds: ["k-yeoncheon"],
  },
  {
    id: "korea-amsa",
    subject: "korea",
    placeIds: ["amsa"],
    title: "한강가에 자리 잡은 신석기 마을",
    period: "기원전 4000~3000년 무렵",
    startYear: -4000,
    endYear: -3000,
    eraIds: ["k-prehistory"],
    summary:
      "암사동 유적에는 신석기 사람들이 움집을 짓고 모여 살았던 흔적이 남아 있다. 빗살무늬토기와 그물추·갈돌·돌도끼 등은 물고기를 잡고 먹을거리를 가공하며 정착 생활을 했음을 보여 준다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 서울 암사동 유적",
        url: "https://encykorea.aks.ac.kr/Article/E0035155",
      },
      {
        title: "서울특별시 미래한강본부 · 한강의 선사유적",
        url: "https://hangang.seoul.go.kr/www/contents/764.do?mid=565",
      },
    ],
    replacesEntryIds: ["k-amsa"],
  },
  {
    id: "korea-silla-administration",
    subject: "korea",
    placeIds: ["gyeongju", "kr-e9c99a172d2b"],
    title: "금성을 중심으로 전국을 정비한 신라",
    period: "7세기 후반",
    startYear: 670,
    endYear: 699,
    eraIds: ["k-unified-silla"],
    summary:
      "삼국 통합 뒤 신라는 수도 금성을 중심으로 지방을 9주와 5소경으로 정비했다. 오늘날 경주에 해당하는 금성은 왕궁과 국가 사찰이 모인 정치·문화의 중심지였다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 신라",
        url: "https://encykorea.aks.ac.kr/Article/E0032800",
      },
    ],
    replacesEntryIds: ["k-gyeongju"],
  },
  {
    id: "korea-jinju-battle",
    subject: "korea",
    placeIds: ["jinju", "kr-6a142297546f"],
    title: "김시민과 군민이 지킨 진주성",
    period: "1592년",
    startYear: 1592,
    eraIds: ["k-joseon-early"],
    summary:
      "1592년 김시민이 지휘하는 조선군과 주민들은 진주성을 공격한 일본군을 막아 냈다. 진주성의 승리는 전라도로 향하는 일본군의 진출을 저지하는 데 중요한 역할을 했다.",
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 진주성 전투",
        url: "https://contents.history.go.kr/mobile/hm/view.do?levelId=hm_079_0050",
      },
    ],
  },
  {
    id: "korea-haeinsa-storage",
    subject: "korea",
    placeIds: ["kr-62d62eafcb03", "kr-6185d7d2721d"],
    title: "대장경을 보존하기 위한 건축",
    period: "조선 전기, 15세기",
    startYear: 1400,
    endYear: 1499,
    eraIds: ["k-joseon-early"],
    summary:
      "해인사 장경판전은 고려 때 새긴 팔만대장경판을 보관하는 건물이다. 통풍과 습도 조절에 알맞게 공간과 창문을 배치하여 오랫동안 목판을 보존해 온 건축 지혜를 보여 준다.",
    sources: [
      {
        title: "한국민족문화대백과사전 · 합천 해인사 장경판전",
        url: "https://encykorea.aks.ac.kr/Article/E0062725",
      },
    ],
  },
  {
    id: "korea-busan-refuge",
    subject: "korea",
    placeIds: ["busan"],
    title: "전쟁 속의 임시수도와 피란 생활",
    period: "1950~1953년",
    startYear: 1950,
    endYear: 1953,
    eraIds: ["k-modern"],
    summary:
      "6·25전쟁 중 부산은 정부가 머문 임시수도이자 수많은 피란민의 생활 터전이었다. 정부청사와 대통령 관저가 옮겨 왔고, 시민과 피란민은 전쟁 속에서 주거와 생계를 꾸려 갔다.",
    sources: [
      {
        title: "부산광역시 임시수도기념관 · 기념관 소개",
        url: "https://www.busan.go.kr/monument/greeting",
      },
    ],
    related: [
      {
        placeId: "seoul",
        reason: "6·25전쟁 중 서울을 떠난 정부는 부산을 임시수도로 삼았다.",
      },
    ],
  },
];

/** The 930 battle was at Gochang (today Andong), not modern Gochang county.
 * Evidence: https://encykorea.aks.ac.kr/Article/E0003996
 */
export const koreaHistoricalEntryCorrections: Record<
  string,
  { placeId?: string; eraIds?: string[]; period?: string }
> = {
  "kr-entry-e37f8b5faaea": {
    placeId: "andong",
    eraIds: ["k-later-three"],
    period: "후삼국",
  },
};
