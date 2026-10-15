import type { AtlasHistoricalStory } from "../lib/historyAtlasStories";

/** Reviewed historical accounts for located textbook/atlas cities. Broad era
 * bounds sort the accounts; the displayed period retains source precision.
 * Coordinates stay the source catalogue city representatives, not monument pins. */
export const atlasWorldRestoredHistoricalStories: AtlasHistoricalStory[] = [
  {
    id: "restored-world-88eb1b60d9a5",
    subject: "world",
    placeIds: ["world-88eb1b60d9a5"],
    title: "비잔티움 문화",
    period: "5~8세기",
    startYear: 400,
    endYear: 799,
    eraIds: ["w-medieval"],
    summary:
      "서로마 제국의 수도였으며 이후 비잔티움 제국이 이탈리아를 다스리는 거점이 된 도시이다. 5~6세기의 성당과 모자이크는 로마 전통과 그리스도교 문화의 결합을 보여 준다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 라벤나",
        url: "https://whc.unesco.org/en/list/788/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
      {
        title: "UNESCO 세계유산센터 · 키예프",
        url: "https://whc.unesco.org/en/list/527/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
    related: [
      {
        placeId: "world-d14c69b9f3f2",
        label: "키예프",
        targetEntryId: "story-restored-world-d14c69b9f3f2-world-d14c69b9f3f2",
        reason:
          "비잔티움 문화의 영향을 서로 다른 시기에 받아들인 도시들이다. 라벤나의 모자이크와 키예프의 성당을 비교할 수 있다.",
      },
    ],
  },
  {
    id: "restored-world-f61188c971b7",
    subject: "world",
    placeIds: ["world-f61188c971b7"],
    title: "세 문화의 도시",
    period: "중세",
    startYear: 700,
    endYear: 1499,
    eraIds: ["w-medieval"],
    summary:
      "이베리아반도에서 이슬람교·그리스도교·유대교 문화가 만난 도시이다. 이슬람 지배와 그리스도교 왕국의 재정복을 거치며 사원·교회·회당과 번역 활동의 전통이 남았다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 톨레도",
        url: "https://whc.unesco.org/en/list/379/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
  },
  {
    id: "restored-world-e5c5a6cda4c3",
    subject: "world",
    placeIds: ["world-e5c5a6cda4c3"],
    title: "북방 교역",
    period: "10~15세기",
    startYear: 900,
    endYear: 1499,
    eraIds: ["w-medieval"],
    summary:
      "발트해·스칸디나비아와 중앙아시아·비잔티움을 잇는 교역로에 자리 잡은 도시이다. 중세 도시 공화국과 정교회 문화가 발달했고 1478년 모스크바에 정복되었다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 노브고로드",
        url: "https://whc.unesco.org/en/list/604/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
      {
        title: "UNESCO 세계유산센터 · 모스크바",
        url: "https://whc.unesco.org/en/list/545/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
    related: [
      {
        placeId: "world-f9e0d07817bd",
        label: "모스크바",
        targetEntryId: "story-restored-world-f9e0d07817bd-world-f9e0d07817bd",
        reason:
          "1478년 모스크바가 노브고로드를 정복했다. 교역 도시 공화국과 모스크바의 권력 확대가 맞물린 관계이다.",
      },
    ],
  },
  {
    id: "restored-world-b71d04848a05",
    subject: "world",
    placeIds: ["world-b71d04848a05"],
    title: "비단길 시장",
    period: "12~18세기",
    startYear: 1100,
    endYear: 1799,
    eraIds: ["w-medieval"],
    summary:
      "동서 교역로가 만나는 이란의 상업 도시이다. 지붕이 이어진 바자르에는 상점뿐 아니라 교육·종교 공간도 모여 있어 상품과 문화가 함께 오간 모습을 보여 준다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 타브리즈",
        url: "https://whc.unesco.org/en/list/1346/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
  },
  {
    id: "restored-world-f1afcae2dabc",
    subject: "world",
    placeIds: ["world-f1afcae2dabc"],
    title: "티베트 불교",
    period: "17~18세기",
    startYear: 1600,
    endYear: 1799,
    eraIds: ["w-early-modern"],
    summary:
      "티베트의 정치와 불교 신앙이 결합한 중심 도시이다. 포탈라궁과 조캉 사원·노르불링카는 통치, 종교 의례, 예술이 서로 연결되어 있었음을 보여 준다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 라싸",
        url: "https://whc.unesco.org/en/list/707/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
  },
  {
    id: "restored-world-2fb960eee7ee",
    subject: "world",
    placeIds: ["world-2fb960eee7ee"],
    title: "이슬람 학문",
    period: "13~14세기",
    startYear: 1200,
    endYear: 1399,
    eraIds: ["w-medieval"],
    summary:
      "마린 왕조의 수도로 번성한 북아프리카의 도시이다. 마드라사·모스크·상인 숙소가 남아 있어 이슬람 학문과 교역이 도시 생활을 이루었음을 보여 준다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 페스",
        url: "https://whc.unesco.org/en/list/170/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
      {
        title: "UNESCO 세계유산센터 · 튀니스",
        url: "https://whc.unesco.org/en/list/36/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
    related: [
      {
        placeId: "world-6c8f7f219544",
        label: "튀니스",
        targetEntryId: "story-restored-world-6c8f7f219544-world-6c8f7f219544",
        reason:
          "북아프리카에서 이슬람 학문과 상업이 발달한 도시들이다. 마드라사와 모스크가 도시 생활에서 한 역할을 비교할 수 있다.",
      },
    ],
  },
  {
    id: "restored-world-6c8f7f219544",
    subject: "world",
    placeIds: ["world-6c8f7f219544"],
    title: "이슬람 도시",
    period: "12~16세기",
    startYear: 1100,
    endYear: 1599,
    eraIds: ["w-medieval"],
    summary:
      "북아프리카에서 무와히드·하프스 왕조 시기에 번성한 이슬람 도시이다. 궁전·모스크·마드라사와 시장이 모인 메디나는 당시 도시의 부와 문화를 보여 준다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 튀니스",
        url: "https://whc.unesco.org/en/list/36/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
      {
        title: "UNESCO 세계유산센터 · 페스",
        url: "https://whc.unesco.org/en/list/170/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
    related: [
      {
        placeId: "world-2fb960eee7ee",
        label: "페스",
        targetEntryId: "story-restored-world-2fb960eee7ee-world-2fb960eee7ee",
        reason:
          "북아프리카에서 이슬람 학문과 상업이 발달한 도시들이다. 마드라사와 모스크가 도시 생활에서 한 역할을 비교할 수 있다.",
      },
    ],
  },
  {
    id: "restored-world-3ab601a376d0",
    subject: "world",
    placeIds: ["world-3ab601a376d0"],
    title: "도나우 교역",
    period: "10~13세기",
    startYear: 900,
    endYear: 1299,
    eraIds: ["w-medieval"],
    summary:
      "도나우강을 따라 상업이 발달한 중세 도시이다. 시장·상인 주택과 12세기의 돌다리는 강을 건너는 교통과 교역이 도시 성장에 중요했음을 보여 준다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 레겐스부르크",
        url: "https://whc.unesco.org/en/list/1155/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
  },
  {
    id: "restored-world-66f95cab05f0",
    subject: "world",
    placeIds: ["world-66f95cab05f0"],
    title: "동서 해상 교역",
    period: "16~18세기",
    startYear: 1550,
    endYear: 1799,
    eraIds: ["w-early-modern"],
    summary:
      "16세기 중엽부터 포르투갈의 행정 아래 중국과 서양의 교역을 이어 준 항구이다. 중국식·포르투갈식 주거와 종교 건축은 오랜 해상 교류의 흔적이다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 마카오",
        url: "https://whc.unesco.org/en/list/1110/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
      {
        title: "UNESCO 세계유산센터 · 몸바사",
        url: "https://whc.unesco.org/en/list/1295/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
    related: [
      {
        placeId: "world-02d9b294203a",
        label: "몸바사",
        targetEntryId: "story-restored-world-02d9b294203a-world-02d9b294203a",
        reason:
          "포르투갈의 해상 진출과 연결된 항구들이다. 중국과의 교역 거점인 마카오와 인도양 항로의 요새가 있던 몸바사를 비교할 수 있다.",
      },
    ],
  },
  {
    id: "restored-world-a6dc5f0de748",
    subject: "world",
    placeIds: ["world-a6dc5f0de748"],
    title: "타이 왕국",
    period: "13~14세기",
    startYear: 1200,
    endYear: 1399,
    eraIds: ["w-medieval"],
    summary:
      "13~14세기 수코타이 왕국의 수도가 있던 지역이다. 불교 사원과 불상에는 주변 문화와 현지 전통을 받아들여 발전시킨 수코타이 양식이 남아 있다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 수코타이",
        url: "https://whc.unesco.org/en/list/574/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
  },
  {
    id: "restored-world-d14c69b9f3f2",
    subject: "world",
    placeIds: ["world-d14c69b9f3f2"],
    title: "정교회 전파",
    period: "10~11세기",
    startYear: 988,
    endYear: 1099,
    eraIds: ["w-medieval"],
    summary:
      "키이우라고도 부르는 도시로, 988년 블라디미르의 세례 이후 그리스도교 문화가 확산되는 중심지가 되었다. 11세기 성 소피아 성당은 콘스탄티노폴리스의 영향을 받은 정교회 문화를 보여 준다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 키예프",
        url: "https://whc.unesco.org/en/list/527/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
      {
        title: "UNESCO 세계유산센터 · 라벤나",
        url: "https://whc.unesco.org/en/list/788/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
    related: [
      {
        placeId: "world-88eb1b60d9a5",
        label: "라벤나",
        targetEntryId: "story-restored-world-88eb1b60d9a5-world-88eb1b60d9a5",
        reason:
          "비잔티움 문화의 영향을 서로 다른 시기에 받아들인 도시들이다. 라벤나의 모자이크와 키예프의 성당을 비교할 수 있다.",
      },
    ],
  },
  {
    id: "restored-world-f9e0d07817bd",
    subject: "world",
    placeIds: ["world-f9e0d07817bd"],
    title: "크렘린",
    period: "14~17세기",
    startYear: 1300,
    endYear: 1699,
    eraIds: ["w-early-modern"],
    summary:
      "크렘린을 중심으로 군주의 권력과 정교회 신앙이 결합한 도시이다. 궁전·성당·성벽은 모스크바가 러시아의 정치 중심지로 성장한 과정을 보여 준다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 모스크바",
        url: "https://whc.unesco.org/en/list/545/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
      {
        title: "UNESCO 세계유산센터 · 노브고로드",
        url: "https://whc.unesco.org/en/list/604/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
    related: [
      {
        placeId: "world-e5c5a6cda4c3",
        label: "노브고로드",
        targetEntryId: "story-restored-world-e5c5a6cda4c3-world-e5c5a6cda4c3",
        reason:
          "1478년 모스크바가 노브고로드를 정복했다. 교역 도시 공화국과 모스크바의 권력 확대가 맞물린 관계이다.",
      },
    ],
  },
  {
    id: "restored-world-4bb835aa0dab",
    subject: "world",
    placeIds: ["world-4bb835aa0dab"],
    title: "중세 상업",
    period: "12~15세기",
    startYear: 1100,
    endYear: 1499,
    eraIds: ["w-medieval"],
    summary:
      "중세 유럽의 주요 상업·문화 도시이다. 시장과 상업 건물, 고딕 건축 및 플랑드르 회화의 전통은 교역으로 성장한 도시 사회를 보여 준다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 브뤼헤",
        url: "https://whc.unesco.org/en/list/996/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
      {
        title: "UNESCO 세계유산센터 · 뤼베크",
        url: "https://whc.unesco.org/en/list/272/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
    related: [
      {
        placeId: "world-a4fdb35d4967",
        label: "뤼베크",
        targetEntryId: "story-restored-world-a4fdb35d4967-world-a4fdb35d4967",
        reason:
          "중세 유럽에서 상업으로 성장한 도시들이다. 브뤼헤의 시장과 뤼베크의 한자 동맹 교역을 비교할 수 있다.",
      },
    ],
  },
  {
    id: "restored-world-a4fdb35d4967",
    subject: "world",
    placeIds: ["world-a4fdb35d4967"],
    title: "한자 동맹",
    period: "13~16세기",
    startYear: 1230,
    endYear: 1535,
    eraIds: ["w-medieval"],
    summary:
      "발트해와 북해 교역을 이끈 한자 동맹의 중심 도시 가운데 하나이다. 상인의 집과 창고·공방이 모인 구시가에는 중세 상업 도시의 구조가 남아 있다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 뤼베크",
        url: "https://whc.unesco.org/en/list/272/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
      {
        title: "UNESCO 세계유산센터 · 브뤼헤",
        url: "https://whc.unesco.org/en/list/996/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
    related: [
      {
        placeId: "world-4bb835aa0dab",
        label: "브뤼헤",
        targetEntryId: "story-restored-world-4bb835aa0dab-world-4bb835aa0dab",
        reason:
          "중세 유럽에서 상업으로 성장한 도시들이다. 브뤼헤의 시장과 뤼베크의 한자 동맹 교역을 비교할 수 있다.",
      },
    ],
  },
  {
    id: "restored-world-02d9b294203a",
    subject: "world",
    placeIds: ["world-02d9b294203a"],
    title: "인도양 항구",
    period: "16~17세기",
    startYear: 1593,
    endYear: 1699,
    eraIds: ["w-early-modern"],
    summary:
      "동아프리카의 항구로, 포르투갈은 인도양 교역로를 장악하려고 1593~1596년 이곳에 예수 요새를 세웠다. 요새는 해상 교역과 유럽 세력의 진출이 맞물린 역사를 보여 준다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 몸바사",
        url: "https://whc.unesco.org/en/list/1295/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
      {
        title: "UNESCO 세계유산센터 · 마카오",
        url: "https://whc.unesco.org/en/list/1110/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
    related: [
      {
        placeId: "world-66f95cab05f0",
        label: "마카오",
        targetEntryId: "story-restored-world-66f95cab05f0-world-66f95cab05f0",
        reason:
          "포르투갈의 해상 진출과 연결된 항구들이다. 중국과의 교역 거점인 마카오와 인도양 항로의 요새가 있던 몸바사를 비교할 수 있다.",
      },
    ],
  },
  {
    id: "restored-world-8bcb5aaf1fe6",
    subject: "world",
    placeIds: ["world-8bcb5aaf1fe6"],
    title: "스와힐리 교역",
    period: "중세~근세",
    startYear: 1000,
    endYear: 1799,
    eraIds: ["w-medieval"],
    summary:
      "동아프리카의 스와힐리 해안 교역 도시이다. 스톤타운의 건축과 도시 생활에는 인도양을 오가며 만난 아프리카·아라비아·인도·유럽 문화가 함께 남아 있다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 잔지바르",
        url: "https://whc.unesco.org/en/list/173/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
  },
  {
    id: "restored-world-ed074edaab7c",
    subject: "world",
    placeIds: ["world-ed074edaab7c"],
    title: "청의 초기 수도",
    period: "17세기",
    startYear: 1625,
    endYear: 1644,
    eraIds: ["w-early-modern"],
    summary:
      "청이 베이징으로 수도를 옮기기 전 정치 중심지로 삼았던 도시이다. 선양 고궁은 만주에서 성장한 청이 중국 중심부로 세력을 넓히던 과정을 보여 준다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 선양",
        url: "https://whc.unesco.org/en/list/439/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
  },
  {
    id: "restored-world-a730c371946e",
    subject: "world",
    placeIds: ["world-a730c371946e"],
    title: "상 왕조·갑골문",
    period: "기원전 13~11세기",
    startYear: -1300,
    endYear: -1046,
    eraIds: ["w-ancient"],
    summary:
      "중국 허난성의 도시로, 부근 은허에 상 왕조 후기의 수도 유적이 남아 있다. 왕릉·궁전 터와 갑골문은 청동기 문화, 왕권, 제사와 문자의 발달을 보여 준다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 안양",
        url: "https://whc.unesco.org/en/list/1114/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
  },
  {
    id: "restored-world-35570aabeb92",
    subject: "world",
    placeIds: ["world-35570aabeb92"],
    title: "대서양 교역",
    period: "16~17세기",
    startYear: 1500,
    endYear: 1699,
    eraIds: ["w-early-modern"],
    summary:
      "에스파냐와 아메리카를 잇는 교역·식민 통치의 중심 도시이다. 대성당·알카사르·인디아스 문서관은 이슬람 문화의 흔적과 왕권, 대서양 무역의 성장을 함께 보여 준다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 세비야",
        url: "https://whc.unesco.org/en/list/383/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
  },
  {
    id: "restored-world-07e5430318de",
    subject: "world",
    placeIds: ["world-07e5430318de"],
    title: "교황청 이전",
    period: "14세기",
    startYear: 1309,
    endYear: 1377,
    eraIds: ["w-medieval"],
    summary:
      "14세기에 교황청이 로마를 떠나 머물렀던 프랑스 남부의 도시이다. 거대한 교황궁은 교황권과 세속 권력의 관계가 달라지던 시기의 정치·종교 중심지였음을 보여 준다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 아비뇽",
        url: "https://whc.unesco.org/en/list/228/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
  },
  {
    id: "restored-world-9f14f6a5fcc9",
    subject: "world",
    placeIds: ["world-9f14f6a5fcc9"],
    title: "십자군 항구",
    period: "12~13세기",
    startYear: 1104,
    endYear: 1291,
    eraIds: ["w-medieval"],
    summary:
      "지중해의 성벽 항구 도시로, 십자군 시대 예루살렘 왕국의 중심지가 되었다. 오늘날 거리 아래에도 당시의 도시 유적이 남아 있어 십자군 국가와 해상 교역의 관계를 보여 준다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 아크레",
        url: "https://whc.unesco.org/en/list/1042/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
  },
  {
    id: "restored-world-3853153f06af",
    subject: "world",
    placeIds: ["world-3853153f06af"],
    title: "전쟁과 도시 재건",
    period: "1944년~전후",
    startYear: 1944,
    endYear: 1953,
    eraIds: ["w-wars"],
    summary:
      "1944년 바르샤바 봉기 때 나치군에 의해 역사 지구 대부분이 파괴된 도시이다. 전쟁 뒤 시민들은 옛 기록을 바탕으로 구시가를 재건했으며, 이는 전쟁의 피해와 공동체의 회복을 보여 준다.",
    sources: [
      {
        title: "UNESCO 세계유산센터 · 바르샤바",
        url: "https://whc.unesco.org/en/list/30/",
        license: "CC BY-SA 3.0 IGO · 한국어 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
      },
    ],
  },
  {
    id: "restored-world-71f0c245b5a4",
    subject: "world",
    placeIds: ["world-71f0c245b5a4"],
    title: "왕권과 의회",
    period: "13세기",
    startYear: 1200,
    endYear: 1299,
    eraIds: ["w-medieval"],
    summary:
      "런던의 웨스트민스터는 13세기에 잉글랜드 왕실 정부와 의회 회의의 중심지가 되었다. 왕궁에서 열린 의회의 역사는 왕권과 대표 기관의 관계가 변화해 온 과정을 보여 준다.",
    sources: [
      {
        title: "영국 의회 · 런던",
        url: "https://erskinemay.parliament.uk/section/4500/history-",
      },
    ],
  },
  {
    id: "restored-world-5b3e89fd66c7",
    subject: "world",
    placeIds: ["world-5b3e89fd66c7"],
    title: "칼뱅의 종교 개혁",
    period: "1541~1564년",
    startYear: 1541,
    endYear: 1564,
    eraIds: ["w-early-modern"],
    summary:
      "1541년 돌아온 칼뱅은 제네바에서 교회 규정을 정비하고 종교 개혁을 이끌었다. 이곳에서 마련한 개혁 교회의 조직은 다른 지역의 개혁 교회에도 영향을 주었다.",
    sources: [
      {
        title: "제네바 주립 기록보관소 · 제네바",
        url: "https://archives-etat-ge.ch/page_de_base/2-geneve-1520-1555-reforme-zwinglienne/",
      },
    ],
  },
  {
    id: "restored-world-b369e43fe03f",
    subject: "world",
    placeIds: ["world-b369e43fe03f"],
    title: "미국 독립 전쟁",
    period: "1781년",
    startYear: 1781,
    endYear: 1781,
    eraIds: ["w-modern"],
    summary:
      "1781년 워싱턴이 지휘한 미국·프랑스 연합군이 영국군을 포위한 곳이다. 콘월리스의 항복은 미국 독립 전쟁의 결정적인 전환점이 되었다.",
    sources: [
      {
        title: "미국 국립공원관리청 · 요크타운",
        url: "https://www.nps.gov/york/index.htm",
      },
    ],
  },
];
