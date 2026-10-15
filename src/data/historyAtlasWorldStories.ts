import type { AtlasHistoricalStory } from "../lib/historyAtlasStories";

/** Correct the individual record, never every appearance of a place name. */
export const worldHistoricalEntryCorrections: Record<
  string,
  {
    unitId?: string;
    eraIds?: string[];
    period?: string;
    title?: string;
  }
> = {
  "world-exp-world-fccf1c2757b2-0": {
    unitId: "world-religions",
    eraIds: ["w-medieval"],
    period: "8세기",
    title: "도다이사와 나라 시대의 국가 불교",
  },
  "world-exp-rome-1": {
    title: "교황권과 서유럽 크리스트교의 중심",
  },
  "world-exp-rome-3": {
    unitId: "world-nations",
    eraIds: ["w-modern"],
    period: "19세기",
    title: "이탈리아 통일과 로마의 편입",
  },
};

/** Independently sourced historical contexts; years with century labels are approximate
 * sorting bounds, not claims that a settlement began or ended in those years. */
export const worldHistoricalStories: AtlasHistoricalStory[] = [
  {
    id: "world-oldowan",
    subject: "world",
    placeIds: ["world-a945f2be5802"],
    title: "초기 인류와 석기의 흔적",
    period: "약 200만 년 전",
    startYear: -2000000,
    eraIds: ["w-prehistory"],
    summary:
      "초기 인류의 화석과 석기가 발견되어, 인류가 도구를 만들며 살아간 과정을 보여 주는 유적이다.",
    sources: [
      {
        title: "UNESCO · Ngorongoro Conservation Area",
        url: "https://whc.unesco.org/en/list/39/",
      },
    ],
  },
  {
    id: "world-lascaux",
    subject: "world",
    placeIds: ["world-195494df6100"],
    title: "구석기인의 동굴 그림",
    period: "후기 구석기",
    startYear: -17000,
    endYear: -15000,
    eraIds: ["w-prehistory"],
    summary:
      "말과 소 등 동물 그림이 남아 있어 구석기인의 생활과 예술을 살펴볼 수 있는 동굴이다.",
    sources: [
      {
        title: "위키백과 · 라스코 동굴",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%9D%BC%EC%8A%A4%EC%BD%94%20%EB%8F%99%EA%B5%B4&oldid=42175243",
      },
    ],
  },
  {
    id: "world-catalhoyuk",
    subject: "world",
    placeIds: ["world-828b82553e1d"],
    title: "농경과 정착 생활의 확대",
    period: "기원전 8~7천년기",
    startYear: -7400,
    endYear: -6200,
    eraIds: ["w-prehistory"],
    summary:
      "집들이 밀집한 신석기시대 정착지로, 농경을 바탕으로 사람들이 모여 살던 모습을 보여 준다.",
    sources: [
      {
        title: "UNESCO · Neolithic Site of Çatalhöyük",
        url: "https://whc.unesco.org/en/list/1405/",
      },
    ],
  },
  {
    id: "world-ur",
    subject: "world",
    placeIds: ["ur"],
    title: "수메르의 도시 국가",
    period: "기원전 3천년기",
    startYear: -3000,
    endYear: -2000,
    eraIds: ["w-ancient"],
    replacesEntryIds: ["w-ur"],
    summary:
      "수메르의 도시 국가로 성장한 곳으로, 달의 신 난나를 위한 지구라트는 신전이 도시 생활의 중심에 있었음을 보여 준다.",
    sources: [
      {
        title: "위키백과 · 우르",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%9A%B0%EB%A5%B4&oldid=40781648",
      },
    ],
  },
  {
    id: "world-giza",
    subject: "world",
    placeIds: ["giza"],
    title: "파라오의 왕권과 피라미드",
    period: "기원전 26~25세기",
    startYear: -2600,
    endYear: -2400,
    eraIds: ["w-ancient"],
    replacesEntryIds: ["w-giza"],
    summary:
      "쿠푸 등 파라오의 피라미드가 세워져, 고대 이집트 왕권과 사후 세계에 대한 믿음을 보여 준다.",
    sources: [
      {
        title: "위키백과 · 기자의 피라미드",
        url: "https://ko.wikipedia.org/w/index.php?title=%EA%B8%B0%EC%9E%90%EC%9D%98%20%ED%94%BC%EB%9D%BC%EB%AF%B8%EB%93%9C&oldid=41807281",
      },
    ],
  },
  {
    id: "world-memphis",
    subject: "world",
    placeIds: ["world-c28adc1d28f4"],
    title: "고대 이집트의 정치 중심지",
    period: "기원전 3천년기",
    startYear: -3000,
    endYear: -2000,
    eraIds: ["w-ancient"],
    replacesEntryIds: ["world-exp-world-c28adc1d28f4-5"],
    summary:
      "이집트 고왕국의 수도로 발전했으며, 주변 왕릉 지대와 함께 초기 이집트 국가의 중심을 이루었다.",
    sources: [
      {
        title: "위키백과 · 멤피스 (이집트)",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%A9%A4%ED%94%BC%EC%8A%A4%20(%EC%9D%B4%EC%A7%91%ED%8A%B8)&oldid=41466741",
      },
    ],
  },
  {
    id: "world-indus",
    subject: "world",
    placeIds: ["mohenjo-daro", "world-97df6cd0732f"],
    title: "계획도시를 만든 인더스 문명",
    period: "기원전 26~19세기",
    startYear: -2600,
    endYear: -1900,
    eraIds: ["w-ancient"],
    replacesEntryIds: ["w-mohenjo", "world-exp-world-97df6cd0732f-0"],
    summary:
      "모헨조다로와 하라파는 인더스 문명의 대표 도시이다. 정비된 거리와 주거 시설은 큰 도시를 조직하여 운영한 사람들의 생활을 보여 준다.",
    sources: [
      {
        title: "위키백과 · 인더스 문명",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%9D%B8%EB%8D%94%EC%8A%A4%20%EB%AC%B8%EB%AA%85&oldid=41993328",
      },
    ],
    related: [
      {
        placeId: "mohenjo-daro",
        fromPlaceIds: ["world-97df6cd0732f"],
        reason:
          "하라파와 모헨조다로는 같은 인더스 문명을 대표하는 도시 유적이다.",
      },
      {
        placeId: "world-97df6cd0732f",
        fromPlaceIds: ["mohenjo-daro"],
        reason:
          "하라파와 모헨조다로는 같은 인더스 문명을 대표하는 도시 유적이다.",
      },
    ],
  },
  {
    id: "world-yin",
    subject: "world",
    placeIds: ["world-5b8ea5131294"],
    title: "갑골문으로 남은 상 왕조",
    period: "기원전 1300~1046년",
    startYear: -1300,
    endYear: -1046,
    eraIds: ["w-ancient"],
    replacesEntryIds: ["world-exp-world-5b8ea5131294-0"],
    summary:
      "상 왕조 후기의 수도 유적으로, 왕실의 점복 기록인 갑골문을 통해 당시 정치와 신앙을 알 수 있다.",
    sources: [
      {
        title: "UNESCO · Yin Xu",
        url: "https://whc.unesco.org/en/list/1114/",
      },
      {
        title: "위키백과 · 은허",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%9D%80%ED%97%88&oldid=42120421",
      },
    ],
  },
  {
    id: "world-babylon",
    subject: "world",
    placeIds: ["world-d9ddae77a31a"],
    title: "함무라비와 메소포타미아 통합",
    period: "기원전 18세기",
    startYear: -1792,
    endYear: -1750,
    eraIds: ["w-ancient"],
    summary:
      "함무라비가 이끈 바빌로니아의 수도로, 메소포타미아를 통합한 왕권과 법의 발전을 보여 준다.",
    sources: [
      {
        title: "위키백과 · 함무라비",
        url: "https://ko.wikipedia.org/w/index.php?title=%ED%95%A8%EB%AC%B4%EB%9D%BC%EB%B9%84&oldid=41758072",
      },
    ],
  },
  {
    id: "world-persepolis",
    subject: "world",
    placeIds: ["world-59e18dcb0269"],
    title: "아케메네스 왕조의 왕실 중심지",
    period: "기원전 6~4세기",
    startYear: -518,
    endYear: -330,
    eraIds: ["w-ancient"],
    replacesEntryIds: ["world-exp-world-59e18dcb0269-0"],
    summary:
      "아케메네스 왕조의 궁전과 의례 공간으로 조성되어, 여러 민족을 거느린 페르시아 제국의 권위를 드러냈다.",
    sources: [
      {
        title: "UNESCO · Persepolis",
        url: "https://whc.unesco.org/en/list/114/",
      },
    ],
  },
  {
    id: "world-athens",
    subject: "world",
    placeIds: ["athens", "world-119cdcf6ee4c", "world-147f05a7502d"],
    title: "시민 정치와 아테네의 번영",
    period: "기원전 5세기",
    startYear: -500,
    endYear: -400,
    eraIds: ["w-ancient"],
    replacesEntryIds: ["w-athens"],
    summary:
      "아테네는 시민의 정치 참여가 확대된 폴리스였다. 아크로폴리스에 세운 파르테논 신전은 전성기 아테네의 문화와 권력을 보여 준다.",
    sources: [
      {
        title: "위키백과 · 아크로폴리스 (아테네)",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%95%84%ED%81%AC%EB%A1%9C%ED%8F%B4%EB%A6%AC%EC%8A%A4%20(%EC%95%84%ED%85%8C%EB%84%A4)&oldid=41781299",
      },
    ],
    related: [
      {
        placeId: "athens",
        fromPlaceIds: ["world-119cdcf6ee4c"],
        reason: "아테네의 아크로폴리스에 파르테논 신전이 세워졌다.",
      },
      {
        placeId: "world-119cdcf6ee4c",
        fromPlaceIds: ["athens", "world-147f05a7502d"],
        reason: "아테네의 아크로폴리스에 파르테논 신전이 세워졌다.",
      },
      {
        placeId: "world-147f05a7502d",
        fromPlaceIds: ["world-119cdcf6ee4c"],
        reason: "아테네의 아크로폴리스에 파르테논 신전이 세워졌다.",
      },
    ],
  },
  {
    id: "world-olympia",
    subject: "world",
    placeIds: ["world-fff4e0bfd841"],
    title: "그리스인들이 모인 제전",
    period: "기원전 8세기 이후",
    startYear: -776,
    endYear: 393,
    eraIds: ["w-ancient"],
    summary:
      "제우스에게 바치는 고대 올림픽 경기가 열려, 여러 폴리스의 그리스인들이 만나는 종교·체육 중심지가 되었다.",
    sources: [
      {
        title: "위키백과 · 고대 올림픽",
        url: "https://ko.wikipedia.org/w/index.php?title=%EA%B3%A0%EB%8C%80%20%EC%98%AC%EB%A6%BC%ED%94%BD&oldid=40514598",
      },
    ],
  },
  {
    id: "world-alexandria",
    subject: "world",
    placeIds: ["world-9d9bf70b7a60"],
    title: "헬레니즘의 학문 중심지",
    period: "기원전 4~1세기",
    startYear: -331,
    endYear: -30,
    eraIds: ["w-ancient"],
    replacesEntryIds: ["world-exp-world-9d9bf70b7a60-0"],
    summary:
      "알렉산드로스가 세운 뒤 프톨레마이오스 왕조의 수도가 되었고, 도서관과 학술 활동이 발달했다.",
    sources: [
      {
        title: "위키백과 · 알렉산드리아",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%95%8C%EB%A0%89%EC%82%B0%EB%93%9C%EB%A6%AC%EC%95%84&oldid=40122234",
      },
    ],
  },
  {
    id: "world-carthage",
    subject: "world",
    placeIds: ["world-9f0de41cfebd"],
    title: "지중해 패권을 둘러싼 경쟁",
    period: "기원전 3~2세기",
    startYear: -264,
    endYear: -146,
    eraIds: ["w-ancient"],
    replacesEntryIds: ["world-exp-world-9f0de41cfebd-0"],
    summary:
      "서지중해의 해상 강국으로 로마와 포에니 전쟁을 벌였으나, 마지막 전쟁에서 로마에 파괴되었다.",
    sources: [
      {
        title: "위키백과 · 포에니 전쟁",
        url: "https://ko.wikipedia.org/w/index.php?title=%ED%8F%AC%EC%97%90%EB%8B%88%20%EC%A0%84%EC%9F%81&oldid=41087129",
      },
    ],
    related: [
      {
        placeId: "rome",
        reason:
          "로마와 카르타고는 지중해의 주도권을 놓고 세 차례 포에니 전쟁을 벌였다.",
      },
    ],
  },
  {
    id: "world-rome",
    subject: "world",
    placeIds: ["rome", "world-0dc97f2223be", "world-bf6e55b112b2"],
    title: "제국 수도의 정치와 시민 생활",
    period: "기원전 1세기~서기 2세기",
    startYear: -27,
    endYear: 200,
    eraIds: ["w-ancient"],
    summary:
      "로마는 제국의 정치 중심지였다. 포룸 로마눔에서는 정치·경제 활동이 이루어졌고, 콜로세움은 검투사 경기와 대규모 행사가 열린 원형 경기장이었다.",
    sources: [
      {
        title: "위키백과 · 로마",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%A1%9C%EB%A7%88&oldid=42583100",
      },
      {
        title: "위키백과 · 콜로세움",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%BD%9C%EB%A1%9C%EC%84%B8%EC%9B%80&oldid=41785131",
      },
      {
        title: "위키백과 · 포룸 로마눔",
        url: "https://ko.wikipedia.org/w/index.php?title=%ED%8F%AC%EB%A3%B8%20%EB%A1%9C%EB%A7%88%EB%88%94&oldid=40291530",
      },
    ],
    related: [
      {
        placeId: "world-0dc97f2223be",
        fromPlaceIds: ["rome"],
        reason:
          "로마의 콜로세움에서는 검투사 경기와 대규모 시민 행사가 열렸다.",
      },
      {
        placeId: "world-bf6e55b112b2",
        fromPlaceIds: ["rome"],
        reason:
          "로마의 포룸 로마눔은 공적인 정치·경제 활동이 이루어진 중심 공간이었다.",
      },
    ],
  },
  {
    id: "world-xian-qin",
    subject: "world",
    placeIds: [
      "world-07b8c66d6a4e",
      "world-374afd061166",
      "world-e5f081252766",
    ],
    title: "중국을 통일한 진과 황제의 무덤",
    period: "기원전 3세기",
    startYear: -221,
    endYear: -206,
    eraIds: ["w-ancient"],
    summary:
      "셴양은 중국을 통일한 진의 수도였다. 진시황의 무덤인 진시황릉과 이를 지키는 군대를 본뜬 병마용 갱은 황제가 동원한 권력을 보여 준다.",
    sources: [
      {
        title: "위키백과 · 진나라",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%A7%84%EB%82%98%EB%9D%BC&oldid=41855765",
      },
      {
        title: "UNESCO · Mausoleum of the First Qin Emperor",
        url: "https://whc.unesco.org/en/list/441/",
      },
    ],
  },
  {
    id: "world-bodhgaya",
    subject: "world",
    placeIds: ["world-8ebf71da60cd"],
    title: "붓다의 깨달음과 불교 성지",
    period: "기원전 1천년기",
    startYear: -500,
    eraIds: ["w-ancient"],
    replacesEntryIds: ["world-exp-world-8ebf71da60cd-1"],
    summary:
      "석가모니가 깨달음을 얻었다고 전해지는 곳으로, 불교도들이 순례하는 중요한 성지가 되었다.",
    sources: [
      {
        title: "위키백과 · 부다가야",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%B6%80%EB%8B%A4%EA%B0%80%EC%95%BC&oldid=39848631",
      },
    ],
  },
  {
    id: "world-sanchi",
    subject: "world",
    placeIds: ["world-7f92f95fbc50"],
    title: "아소카와 불교의 확산",
    period: "기원전 3세기 이후",
    startYear: -250,
    endYear: 100,
    eraIds: ["w-ancient"],
    summary:
      "아소카 시대에 시작된 불교 유적으로, 탑과 조각을 통해 불교 신앙이 널리 퍼진 모습을 보여 준다.",
    sources: [
      {
        title: "UNESCO · Buddhist Monuments at Sanchi",
        url: "https://whc.unesco.org/en/list/524/",
      },
    ],
  },
  {
    id: "world-pataliputra",
    subject: "world",
    placeIds: ["world-eccf638c9772"],
    title: "인도 통일 왕조의 수도",
    period: "기원전 4~3세기",
    startYear: -320,
    endYear: -185,
    eraIds: ["w-ancient"],
    summary:
      "마우리아 왕조의 수도로서 북인도와 넓은 영토를 다스리는 정치 중심지였다.",
    sources: [
      {
        title: "위키백과 · 파탈리푸트라",
        url: "https://ko.wikipedia.org/w/index.php?title=%ED%8C%8C%ED%83%88%EB%A6%AC%ED%91%B8%ED%8A%B8%EB%9D%BC&oldid=41940010",
      },
    ],
  },
  {
    id: "world-jerusalem",
    subject: "world",
    placeIds: ["world-bba99c8a182a"],
    title: "여러 종교의 성지가 된 도시",
    period: "고대~중세",
    startYear: -1000,
    endYear: 1500,
    eraIds: ["w-ancient", "w-medieval"],
    unitId: "world-religions",
    summary:
      "유대교·크리스트교·이슬람교의 중요한 성지가 모여 있어, 신앙과 정치가 겹치는 역사적 중심지가 되었다.",
    sources: [
      {
        title: "위키백과 · 예루살렘",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%98%88%EB%A3%A8%EC%82%B4%EB%A0%98&oldid=42364364",
      },
    ],
  },
  {
    id: "world-mecca",
    subject: "world",
    placeIds: ["mecca"],
    title: "이슬람교의 성립과 순례",
    period: "7세기",
    startYear: 610,
    endYear: 632,
    eraIds: ["w-medieval"],
    replacesEntryIds: ["w-mecca"],
    summary:
      "무함마드가 태어나 이슬람교를 전하기 시작한 도시이며, 카바를 중심으로 이슬람 순례의 중심지가 되었다.",
    sources: [
      {
        title: "위키백과 · 메카",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%A9%94%EC%B9%B4&oldid=41456428",
      },
    ],
  },
  {
    id: "world-medina",
    subject: "world",
    placeIds: ["world-685a859c916f"],
    title: "헤지라와 이슬람 공동체",
    period: "622년",
    startYear: 622,
    endYear: 632,
    eraIds: ["w-medieval"],
    replacesEntryIds: ["world-exp-world-685a859c916f-1"],
    summary:
      "무함마드가 박해를 피해 메카에서 이주한 곳으로, 이 사건은 이슬람 공동체가 발전하는 전환점이 되었다.",
    sources: [
      {
        title: "위키백과 · 헤지라",
        url: "https://ko.wikipedia.org/w/index.php?title=%ED%97%A4%EC%A7%80%EB%9D%BC&oldid=39099491",
      },
    ],
    related: [
      {
        placeId: "mecca",
        reason:
          "무함마드는 622년 메카에서 메디나로 이주하여 이슬람 공동체를 이끌었다.",
      },
    ],
  },
  {
    id: "world-damascus",
    subject: "world",
    placeIds: ["world-b101efd1859e", "world-2be2d8c6b68b"],
    title: "우마이야 왕조의 통치와 종교 건축",
    period: "661~750년",
    startYear: 661,
    endYear: 750,
    eraIds: ["w-medieval"],
    summary:
      "다마스쿠스는 우마이야 왕조의 수도였다. 도시 중심의 우마이야 모스크는 왕조의 종교 생활과 초기 이슬람 건축을 보여 준다.",
    sources: [
      {
        title: "위키백과 · 우마이야 왕조",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%9A%B0%EB%A7%88%EC%9D%B4%EC%95%BC%20%EC%99%95%EC%A1%B0&oldid=39591106",
      },
      {
        title: "UNESCO · Ancient City of Damascus",
        url: "https://whc.unesco.org/en/list/20/",
      },
    ],
  },
  {
    id: "world-baghdad",
    subject: "world",
    placeIds: ["baghdad"],
    title: "아바스 왕조와 학문의 교류",
    period: "8~13세기",
    startYear: 762,
    endYear: 1258,
    eraIds: ["w-medieval"],
    replacesEntryIds: ["w-baghdad"],
    summary:
      "아바스 왕조가 새 수도로 세운 도시로, 여러 지역의 지식과 상품이 모이는 이슬람 세계의 중심지로 번성했다.",
    sources: [
      {
        title: "위키백과 · 바그다드",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%B0%94%EA%B7%B8%EB%8B%A4%EB%93%9C&oldid=39017810",
      },
    ],
  },
  {
    id: "world-constantinople",
    subject: "world",
    placeIds: ["istanbul", "world-ce18f783b00f"],
    displayNames: { istanbul: "콘스탄티노폴리스" },
    title: "비잔티움의 정치와 정교회 문화",
    period: "4~15세기",
    startYear: 330,
    endYear: 1453,
    eraIds: ["w-ancient", "w-medieval"],
    unitId: "world-religions",
    replacesEntryIds: [
      "w-constantinople",
      "world-exp-istanbul-0",
      "world-exp-istanbul-1",
    ],
    summary:
      "콘스탄티노폴리스는 로마의 새 수도로 출발해 비잔티움 제국의 정치·교역 중심지가 되었다. 그곳의 성 소피아 대성당은 정교회 신앙과 비잔티움 건축을 보여 준다.",
    sources: [
      {
        title: "위키백과 · 콘스탄티노폴리스",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%BD%98%EC%8A%A4%ED%83%84%ED%8B%B0%EB%85%B8%ED%8F%B4%EB%A6%AC%EC%8A%A4&oldid=41789922",
      },
      {
        title: "위키백과 · 아야 소피아",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%95%84%EC%95%BC%20%EC%86%8C%ED%94%BC%EC%95%84&oldid=41936272",
      },
    ],
    related: [
      {
        placeId: "istanbul",
        fromPlaceIds: ["world-ce18f783b00f"],
        reason:
          "콘스탄티노폴리스의 성 소피아 대성당은 비잔티움 제국의 정교회 중심 공간이었다.",
      },
      {
        placeId: "world-ce18f783b00f",
        fromPlaceIds: ["istanbul"],
        reason:
          "콘스탄티노폴리스의 성 소피아 대성당은 비잔티움 제국의 정교회 중심 공간이었다.",
      },
    ],
  },
  {
    id: "world-cordoba",
    subject: "world",
    placeIds: ["world-1c1dfe790ef3", "world-3441614bbb90"],
    title: "이베리아의 이슬람 문화",
    period: "8~11세기",
    startYear: 756,
    endYear: 1031,
    eraIds: ["w-medieval"],
    summary:
      "코르도바는 후우마이야 왕조의 정치·문화 중심지였다. 코르도바 대모스크는 그 번영을 보여 주는 이슬람 종교 건축물이다.",
    sources: [
      {
        title: "UNESCO · Historic Centre of Cordoba",
        url: "https://whc.unesco.org/en/list/313/",
      },
    ],
  },
  {
    id: "world-changan-tang",
    subject: "world",
    placeIds: ["xian", "world-b34e87aa7e42"],
    title: "당의 수도 생활과 황제의 궁궐",
    period: "7~9세기",
    startYear: 618,
    endYear: 907,
    eraIds: ["w-medieval"],
    replacesEntryIds: ["w-xian"],
    summary:
      "장안은 각국 사절·상인·승려가 모인 당의 수도였다. 장안의 대명궁은 황제가 정사를 처리하던 궁궐로, 제국의 통치와 궁정 문화를 보여 준다.",
    sources: [
      {
        title: "위키백과 · 장안",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%9E%A5%EC%95%88&oldid=39025782",
      },
      {
        title: "시안시 · 대명궁 국가유적공원",
        url: "https://en.xa.gov.cn/CultureTravel/Attractions/1691691501627232258.html",
      },
    ],
  },
  {
    id: "world-dunhuang",
    subject: "world",
    placeIds: ["world-bf0c345a5654"],
    title: "비단길의 불교 문화",
    period: "4~14세기",
    startYear: 366,
    endYear: 1400,
    eraIds: ["w-medieval"],
    summary:
      "비단길의 길목에서 상인과 승려가 오갔으며, 막고굴의 불교 미술에는 여러 지역 문화가 함께 남았다.",
    sources: [
      {
        title: "UNESCO · Mogao Caves",
        url: "https://whc.unesco.org/en/list/440/",
      },
    ],
  },
  {
    id: "world-samarkand",
    subject: "world",
    placeIds: ["world-e7b216b2a964", "world-dda0e2793f60"],
    title: "티무르 시대의 도시와 학문",
    period: "14~15세기",
    startYear: 1370,
    endYear: 1500,
    eraIds: ["w-medieval", "w-early-modern"],
    summary:
      "사마르칸트는 티무르 제국의 수도로 번성했다. 레기스탄 광장의 울루그 베그 마드라사는 15세기에 세운 이슬람 학교로, 도시의 학문과 건축 문화를 보여 준다.",
    sources: [
      {
        title: "UNESCO · Samarkand – Crossroad of Cultures",
        url: "https://whc.unesco.org/en/list/603/",
      },
      {
        title: "위키백과 · 사마르칸트",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%82%AC%EB%A7%88%EB%A5%B4%EC%B9%B8%ED%8A%B8&oldid=42548205",
      },
      {
        title: "위키백과 · 레기스탄",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%A0%88%EA%B8%B0%EC%8A%A4%ED%83%84&oldid=41244213",
      },
    ],
  },
  {
    id: "world-nara",
    subject: "world",
    placeIds: ["nara"],
    title: "일본의 율령 국가와 불교",
    period: "8세기",
    startYear: 710,
    endYear: 784,
    eraIds: ["w-medieval"],
    replacesEntryIds: ["w-nara"],
    summary:
      "일본이 당의 제도를 받아들여 정비한 수도로, 도다이사 등 사찰은 국가가 불교를 후원한 모습을 보여 준다.",
    sources: [
      {
        title: "위키백과 · 헤이조쿄",
        url: "https://ko.wikipedia.org/w/index.php?title=%ED%97%A4%EC%9D%B4%EC%A1%B0%EC%BF%84&oldid=39395479",
      },
      {
        title: "UNESCO · Historic Monuments of Ancient Nara",
        url: "https://whc.unesco.org/en/list/870/",
      },
    ],
    related: [
      {
        placeId: "xian",
        reason: "일본은 당의 수도 장안을 본떠 헤이조쿄를 건설했다.",
      },
    ],
  },
  {
    id: "world-todaiji",
    subject: "world",
    placeIds: ["world-fccf1c2757b2"],
    title: "국가가 후원한 대불 조성",
    period: "743~752년",
    startYear: 743,
    endYear: 752,
    eraIds: ["w-medieval"],
    summary:
      "쇼무 천황의 명으로 거대한 불상을 만들고 752년 완성 법회를 열어, 나라 시대 국가가 불교를 후원한 모습을 보여 준다.",
    sources: [
      {
        title: "도다이지 공식 역사",
        url: "https://www.todaiji.or.jp/ko/history/",
      },
    ],
    related: [
      {
        placeId: "nara",
        reason:
          "도다이사는 나라 시대 수도 헤이조쿄에 세운 국가 불교의 중심 사찰이다.",
      },
    ],
  },
  {
    id: "world-kyoto",
    subject: "world",
    placeIds: ["world-23f8483f8d47"],
    title: "헤이안 천도와 일본의 왕도",
    period: "794년 이후",
    startYear: 794,
    endYear: 1185,
    eraIds: ["w-medieval"],
    summary:
      "794년 헤이안쿄로 천도한 뒤 천황의 거처와 귀족 문화의 중심지가 되었다.",
    sources: [
      {
        title: "위키백과 · 헤이안쿄",
        url: "https://ko.wikipedia.org/w/index.php?title=%ED%97%A4%EC%9D%B4%EC%95%88%EC%BF%84&oldid=41628347",
      },
    ],
    related: [
      {
        placeId: "xian",
        reason: "헤이안쿄로 세운 교토의 도성은 당의 수도 장안을 본떴다.",
      },
    ],
  },
  {
    id: "world-kaifeng",
    subject: "world",
    placeIds: ["kaifeng"],
    title: "북송의 수도와 도시 경제",
    period: "10~12세기",
    startYear: 960,
    endYear: 1127,
    eraIds: ["w-medieval"],
    replacesEntryIds: ["w-kaifeng"],
    summary:
      "북송의 수도로서 인구와 상업이 집중되었으며, 도시 소비와 시장의 발달을 보여 주는 중심지였다.",
    sources: [
      {
        title: "위키백과 · 카이펑시",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%B9%B4%EC%9D%B4%ED%8E%91%EC%8B%9C&oldid=41679720",
      },
    ],
  },
  {
    id: "world-hangzhou",
    subject: "world",
    placeIds: ["world-872972e9a3dc"],
    title: "남송의 수도와 강남 경제",
    period: "12~13세기",
    startYear: 1138,
    endYear: 1276,
    eraIds: ["w-medieval"],
    summary:
      "북방을 잃은 송이 남쪽으로 옮긴 뒤 수도가 되었으며, 강남의 상업과 도시 문화가 번성한 곳이다.",
    sources: [
      {
        title: "위키백과 · 항저우시",
        url: "https://ko.wikipedia.org/w/index.php?title=%ED%95%AD%EC%A0%80%EC%9A%B0%EC%8B%9C&oldid=42375879",
      },
    ],
    related: [
      {
        placeId: "kaifeng",
        reason: "금에 카이펑을 잃은 송은 남쪽의 항저우를 새로운 수도로 삼았다.",
      },
    ],
  },
  {
    id: "world-karakorum",
    subject: "world",
    placeIds: ["karakorum"],
    title: "몽골 제국의 수도",
    period: "13세기",
    startYear: 1235,
    endYear: 1260,
    eraIds: ["w-medieval"],
    replacesEntryIds: ["world-exp-karakorum-2"],
    summary:
      "오고타이 때 수도로 정비되어 몽골 제국의 정치 중심이 되었고, 여러 지역의 사람과 물자가 모였다.",
    sources: [
      {
        title: "위키백과 · 카라코룸",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%B9%B4%EB%9D%BC%EC%BD%94%EB%A3%B8&oldid=41137533",
      },
    ],
  },
  {
    id: "world-quanzhou",
    subject: "world",
    placeIds: ["world-f1bc721d62c8"],
    title: "송·원 시대의 해상 교역",
    period: "10~14세기",
    startYear: 960,
    endYear: 1368,
    eraIds: ["w-medieval"],
    summary:
      "중국을 인도양 교역망과 연결한 항구로, 상업과 여러 종교가 함께 발달한 해상 교류의 중심지였다.",
    sources: [
      {
        title: "UNESCO · Quanzhou: Emporium of the World in Song-Yuan China",
        url: "https://whc.unesco.org/en/list/1561/",
      },
    ],
  },
  {
    id: "world-angkor",
    subject: "world",
    placeIds: ["world-9eed50d315d4"],
    title: "크메르 왕국의 신앙과 왕권",
    period: "12세기",
    startYear: 1100,
    endYear: 1200,
    eraIds: ["w-medieval"],
    summary:
      "크메르 왕국이 비슈누에게 바치는 거대한 사원으로 세웠으며, 왕권과 힌두교 신앙의 관계를 보여 준다.",
    sources: [
      {
        title: "위키백과 · 앙코르 와트",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%95%99%EC%BD%94%EB%A5%B4%20%EC%99%80%ED%8A%B8&oldid=42353527",
      },
    ],
  },
  {
    id: "world-borobudur",
    subject: "world",
    placeIds: ["world-231991299b29"],
    title: "자와섬의 불교 문화",
    period: "8~9세기",
    startYear: 750,
    endYear: 850,
    eraIds: ["w-medieval"],
    summary:
      "자와섬에 세운 대규모 불교 유적으로, 불교의 가르침을 부조와 탑의 구조로 표현했다.",
    sources: [
      {
        title: "UNESCO · Borobudur Temple Compounds",
        url: "https://whc.unesco.org/en/list/592/",
      },
    ],
  },
  {
    id: "world-bagan",
    subject: "world",
    placeIds: ["world-63658712255f"],
    title: "파간 왕국의 불교 중심지",
    period: "11~13세기",
    startYear: 1044,
    endYear: 1287,
    eraIds: ["w-medieval"],
    summary:
      "파간 왕국의 수도로서 수많은 불교 사원과 탑이 세워져 미얀마의 불교 문화를 형성했다.",
    sources: [
      {
        title: "UNESCO · Bagan",
        url: "https://whc.unesco.org/en/list/1588/",
      },
    ],
  },
  {
    id: "world-timbuktu",
    subject: "world",
    placeIds: ["world-d12515f624d6"],
    title: "사하라 교역과 이슬람 학문",
    period: "14~16세기",
    startYear: 1300,
    endYear: 1600,
    eraIds: ["w-medieval", "w-early-modern"],
    summary:
      "사하라 횡단 교역망의 도시로 성장했으며, 이슬람 학문과 필사본 문화가 발달했다.",
    sources: [
      {
        title: "위키백과 · 팀북투",
        url: "https://ko.wikipedia.org/w/index.php?title=%ED%8C%80%EB%B6%81%ED%88%AC&oldid=39070008",
      },
    ],
  },
  {
    id: "world-venice",
    subject: "world",
    placeIds: ["world-d504fb66dba4"],
    title: "지중해의 해상 무역 도시",
    period: "중세",
    startYear: 1000,
    endYear: 1500,
    eraIds: ["w-medieval"],
    summary:
      "동부 지중해와 유럽을 잇는 무역으로 성장한 도시 국가로, 상인들이 해상 교역망을 운영했다.",
    sources: [
      {
        title: "위키백과 · 베네치아 공화국",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%B2%A0%EB%84%A4%EC%B9%98%EC%95%84%20%EA%B3%B5%ED%99%94%EA%B5%AD&oldid=41628874",
      },
    ],
  },
  {
    id: "world-florence",
    subject: "world",
    placeIds: ["world-b93b961da157"],
    title: "르네상스의 중심지",
    period: "14~16세기",
    startYear: 1300,
    endYear: 1550,
    eraIds: ["w-early-modern"],
    summary:
      "상업과 금융으로 축적한 부를 바탕으로 미술·건축·인문주의를 후원하며 르네상스가 꽃핀 도시이다.",
    sources: [
      {
        title: "위키백과 · 피렌체",
        url: "https://ko.wikipedia.org/w/index.php?title=%ED%94%BC%EB%A0%8C%EC%B2%B4&oldid=42452183",
      },
    ],
  },
  {
    id: "world-wittenberg",
    subject: "world",
    placeIds: ["world-db517ae6e2e9"],
    title: "루터와 종교 개혁",
    period: "1517년 이후",
    startYear: 1517,
    endYear: 1555,
    eraIds: ["w-early-modern"],
    summary:
      "루터의 활동 거점으로, 면벌부 비판에서 시작된 종교 개혁이 확산하는 중심지가 되었다.",
    sources: [
      {
        title: "위키백과 · 비텐베르크",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%B9%84%ED%85%90%EB%B2%A0%EB%A5%B4%ED%81%AC&oldid=42588772",
      },
    ],
  },
  {
    id: "world-istanbul-ottoman",
    subject: "world",
    placeIds: ["istanbul", "world-04c176b5e44a"],
    displayNames: { istanbul: "이스탄불" },
    title: "오스만 수도와 술탄의 궁정",
    period: "1453년 이후",
    startYear: 1453,
    endYear: 1922,
    eraIds: ["w-early-modern"],
    replacesEntryIds: ["w-istanbul", "world-exp-istanbul-2"],
    summary:
      "이스탄불은 1453년 오스만의 정복 뒤 제국의 수도가 되었다. 그곳의 톱카프궁전은 술탄의 거처이자 국정을 논의하던 통치 공간이었다.",
    sources: [
      {
        title: "위키백과 · 이스탄불",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%9D%B4%EC%8A%A4%ED%83%84%EB%B6%88&oldid=42384955",
      },
      {
        title: "위키백과 · 톱카프 궁전",
        url: "https://ko.wikipedia.org/w/index.php?title=%ED%86%B1%EC%B9%B4%ED%94%84%20%EA%B6%81%EC%A0%84&oldid=39513404",
      },
    ],
  },
  {
    id: "world-beijing-ming",
    subject: "world",
    placeIds: ["beijing", "world-9b94ffe0e820"],
    title: "명·청의 수도와 황제의 궁궐",
    period: "15~20세기",
    startYear: 1421,
    endYear: 1912,
    eraIds: ["w-early-modern"],
    replacesEntryIds: ["w-beijing"],
    summary:
      "베이징은 명 영락제의 천도 뒤 명·청의 수도가 되었다. 자금성은 베이징에서 황제가 거주하고 통치한 궁궐로, 두 왕조의 궁정 문화를 보여 준다.",
    sources: [
      {
        title: "위키백과 · 자금성",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%9E%90%EA%B8%88%EC%84%B1&oldid=42030993",
      },
    ],
    related: [
      {
        placeId: "beijing",
        fromPlaceIds: ["world-9b94ffe0e820"],
        reason: "베이징의 자금성은 명·청 황제가 거주하고 통치하던 궁궐이다.",
      },
      {
        placeId: "world-9b94ffe0e820",
        fromPlaceIds: ["beijing"],
        reason: "베이징의 자금성은 명·청 황제가 거주하고 통치하던 궁궐이다.",
      },
    ],
  },
  {
    id: "world-agra",
    subject: "world",
    placeIds: ["agra", "world-fa40bf609e6e"],
    title: "무굴 제국의 궁정 문화",
    period: "16~17세기",
    startYear: 1526,
    endYear: 1658,
    eraIds: ["w-early-modern"],
    replacesEntryIds: ["w-agra", "world-exp-world-fa40bf609e6e-2"],
    summary:
      "무굴 제국의 주요 수도 아그라에서 샤자한이 황후를 기려 세운 타지마할은 인도와 이슬람 건축 문화가 어우러진 모습을 보여 준다.",
    sources: [
      {
        title: "위키백과 · 아그라",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%95%84%EA%B7%B8%EB%9D%BC&oldid=41149022",
      },
      {
        title: "UNESCO · Taj Mahal",
        url: "https://whc.unesco.org/en/list/252/",
      },
    ],
    related: [
      {
        placeId: "agra",
        fromPlaceIds: ["world-fa40bf609e6e"],
        reason: "무굴 황제 샤자한은 아그라에 황후를 기리는 타지마할을 세웠다.",
      },
      {
        placeId: "world-fa40bf609e6e",
        fromPlaceIds: ["agra"],
        reason: "무굴 황제 샤자한은 아그라에 황후를 기리는 타지마할을 세웠다.",
      },
    ],
  },
  {
    id: "world-isfahan",
    subject: "world",
    placeIds: ["world-2d45ecf65497", "world-ec11b0970d7a"],
    title: "사파비 수도의 정치·종교·상업",
    period: "16세기 말~18세기 초",
    startYear: 1598,
    endYear: 1722,
    eraIds: ["w-early-modern"],
    summary:
      "이스파한은 아바스 1세가 수도로 삼아 정비한 도시이다. 이맘 광장은 왕궁·모스크·시장과 연결된 공간으로, 사파비 왕조의 정치·종교·상업 생활을 보여 준다.",
    sources: [
      {
        title: "위키백과 · 이스파한",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%9D%B4%EC%8A%A4%ED%8C%8C%ED%95%9C&oldid=40094050",
      },
      {
        title: "UNESCO · Meidan Emam, Esfahan",
        url: "https://whc.unesco.org/en/list/115/",
      },
    ],
  },
  {
    id: "world-lisbon",
    subject: "world",
    placeIds: ["lisbon"],
    title: "포르투갈의 해양 진출",
    period: "15~16세기",
    startYear: 1400,
    endYear: 1600,
    eraIds: ["w-early-modern"],
    replacesEntryIds: ["w-lisbon"],
    summary:
      "대서양과 인도양으로 나아간 포르투갈 항해와 무역의 중심 항구로 성장했다.",
    sources: [
      {
        title: "위키백과 · 리스본",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%A6%AC%EC%8A%A4%EB%B3%B8&oldid=42249150",
      },
    ],
  },
  {
    id: "world-malacca",
    subject: "world",
    placeIds: ["world-c69a008674e1"],
    title: "동서 해상 교역의 길목",
    period: "15~16세기",
    startYear: 1400,
    endYear: 1511,
    eraIds: ["w-early-modern"],
    summary:
      "인도양과 남중국해를 연결하는 항구로 번성했으며, 1511년 포르투갈의 점령 뒤 유럽 세력의 아시아 진출 거점이 되었다.",
    sources: [
      {
        title: "위키백과 · 믈라카",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%AF%88%EB%9D%BC%EC%B9%B4&oldid=42537164",
      },
    ],
  },
  {
    id: "world-manila",
    subject: "world",
    placeIds: ["world-287e29e93d5f", "world-68f0c26b6639"],
    title: "태평양을 건넌 은과 상품",
    period: "1565~1815년",
    startYear: 1565,
    endYear: 1815,
    eraIds: ["w-early-modern"],
    summary:
      "마닐라와 아카풀코 사이의 갈레온 무역은 아시아 상품과 아메리카의 은을 태평양을 건너 교환하게 했다.",
    sources: [
      {
        title: "위키백과 · 마닐라 갈레온",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%A7%88%EB%8B%90%EB%9D%BC%20%EA%B0%88%EB%A0%88%EC%98%A8&oldid=41963938",
      },
    ],
    related: [
      {
        placeId: "world-287e29e93d5f",
        fromPlaceIds: ["world-68f0c26b6639"],
        reason:
          "마닐라와 아카풀코 사이의 갈레온 무역은 아시아 상품과 아메리카의 은을 교환했다.",
      },
      {
        placeId: "world-68f0c26b6639",
        fromPlaceIds: ["world-287e29e93d5f"],
        reason:
          "마닐라와 아카풀코 사이의 갈레온 무역은 아시아 상품과 아메리카의 은을 교환했다.",
      },
    ],
  },
  {
    id: "world-potosi",
    subject: "world",
    placeIds: ["world-3cc22b04fb0d"],
    title: "은광과 식민지 경제",
    period: "16~17세기",
    startYear: 1545,
    endYear: 1700,
    eraIds: ["w-early-modern"],
    summary:
      "대규모 은광 개발로 스페인 식민지 경제의 핵심이 되었으며, 은 생산에는 원주민의 강제 노동이 동원되었다.",
    sources: [
      {
        title: "UNESCO · City of Potosí",
        url: "https://whc.unesco.org/en/list/420/",
      },
    ],
  },
  {
    id: "world-cusco",
    subject: "world",
    placeIds: ["world-df9ce94dff2b"],
    title: "잉카 제국의 수도",
    period: "15~16세기",
    startYear: 1400,
    endYear: 1533,
    eraIds: ["w-early-modern"],
    summary:
      "잉카 제국의 수도로서 정치·종교·문화의 중심을 이루었으며, 안데스 지역을 다스리는 거점이 되었다.",
    sources: [
      {
        title: "위키백과 · 쿠스코",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%BF%A0%EC%8A%A4%EC%BD%94&oldid=42431317",
      },
    ],
  },
  {
    id: "world-tenochtitlan",
    subject: "world",
    placeIds: ["world-5ec32e9ad526"],
    title: "아스테카의 호수 위 수도",
    period: "14~16세기",
    startYear: 1325,
    endYear: 1521,
    eraIds: ["w-early-modern"],
    summary:
      "아스테카의 수도로 호수 위에 건설되었으나, 1521년 에스파냐 정복군에 함락되었다.",
    sources: [
      {
        title: "위키백과 · 테노치티틀란",
        url: "https://ko.wikipedia.org/w/index.php?title=%ED%85%8C%EB%85%B8%EC%B9%98%ED%8B%B0%ED%8B%80%EB%9E%80&oldid=42602627",
      },
    ],
  },
  {
    id: "world-nagasaki",
    subject: "world",
    placeIds: ["world-1ef115875c31", "world-85f7f6427d22"],
    title: "에도 시대의 제한된 대외 교역",
    period: "17~19세기",
    startYear: 1641,
    endYear: 1859,
    eraIds: ["w-early-modern"],
    summary:
      "나가사키는 에도 막부가 대외 교역을 통제한 항구였다. 항구의 인공섬 데지마에는 네덜란드 상관이 자리하여 서양 지식과 상품이 들어오는 창구가 되었다.",
    sources: [
      {
        title: "위키백과 · 데지마",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%8D%B0%EC%A7%80%EB%A7%88&oldid=42435648",
      },
    ],
    related: [
      {
        placeId: "world-1ef115875c31",
        fromPlaceIds: ["world-85f7f6427d22"],
        reason:
          "나가사키의 데지마는 에도 시대에 네덜란드 상관이 자리한 대외 교역 창구였다.",
      },
      {
        placeId: "world-85f7f6427d22",
        fromPlaceIds: ["world-1ef115875c31"],
        reason:
          "나가사키의 데지마는 에도 시대에 네덜란드 상관이 자리한 대외 교역 창구였다.",
      },
    ],
  },
  {
    id: "world-edo",
    subject: "world",
    placeIds: ["tokyo"],
    displayNames: { tokyo: "에도" },
    title: "도쿠가와 막부의 정치 중심",
    period: "1603~1868년",
    startYear: 1603,
    endYear: 1868,
    eraIds: ["w-early-modern"],
    summary:
      "도쿠가와 막부의 거점이 된 에도에는 무사와 상인이 모였으며, 거대한 소비 도시로 성장했다.",
    sources: [
      {
        title: "위키백과 · 에도",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%97%90%EB%8F%84&oldid=39424975",
      },
    ],
  },
  {
    id: "world-amsterdam",
    subject: "world",
    placeIds: ["world-b5dda255b318"],
    title: "네덜란드의 해상 무역과 금융",
    period: "17세기",
    startYear: 1600,
    endYear: 1700,
    eraIds: ["w-early-modern"],
    summary:
      "네덜란드의 해상 진출과 함께 무역·금융 중심지로 성장하며 세계 각지의 상품과 자금이 모였다.",
    sources: [
      {
        title: "UNESCO · Seventeenth-Century Canal Ring Area of Amsterdam",
        url: "https://whc.unesco.org/en/list/1349/",
      },
    ],
  },
  {
    id: "world-versailles-monarchy",
    subject: "world",
    placeIds: ["versailles", "world-0b5aaef85c9c"],
    title: "루이 14세의 궁정과 왕권",
    period: "1682년 이후",
    startYear: 1682,
    endYear: 1789,
    eraIds: ["w-early-modern"],
    replacesEntryIds: ["world-exp-world-0b5aaef85c9c-2"],
    summary:
      "루이 14세는 베르사유 궁전에 궁정과 정부를 옮겨 베르사유를 정치 중심지로 삼았다. 궁전은 귀족을 궁정 생활에 묶어 두며 왕권을 드러내는 무대가 되었다.",
    sources: [
      {
        title: "위키백과 · 베르사유궁",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%B2%A0%EB%A5%B4%EC%82%AC%EC%9C%A0%EA%B6%81&oldid=42280975",
      },
    ],
    related: [
      {
        placeId: "versailles",
        fromPlaceIds: ["world-0b5aaef85c9c"],
        reason:
          "루이 14세는 베르사유 궁전에 궁정과 정부를 옮겨 베르사유를 정치 중심지로 삼았다.",
      },
      {
        placeId: "world-0b5aaef85c9c",
        fromPlaceIds: ["versailles"],
        reason:
          "루이 14세는 베르사유 궁전에 궁정과 정부를 옮겨 베르사유를 정치 중심지로 삼았다.",
      },
    ],
  },
  {
    id: "world-boston",
    subject: "world",
    placeIds: ["boston"],
    title: "식민지의 저항과 독립 전쟁",
    period: "1773~1775년",
    startYear: 1773,
    endYear: 1775,
    eraIds: ["w-modern"],
    replacesEntryIds: ["w-boston", "world-exp-boston-3"],
    summary:
      "차에 대한 세금과 영국의 통제에 맞선 저항이 커진 도시로, 미국 독립 전쟁으로 이어지는 갈등의 중심지였다.",
    sources: [
      {
        title: "위키백과 · 보스턴 차 사건",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%B3%B4%EC%8A%A4%ED%84%B4%20%EC%B0%A8%20%EC%82%AC%EA%B1%B4&oldid=42532677",
      },
      {
        title: "위키백과 · 독립기념관 (미국)",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%8F%85%EB%A6%BD%EA%B8%B0%EB%85%90%EA%B4%80%20(%EB%AF%B8%EA%B5%AD)&oldid=42570671",
      },
    ],
    related: [
      {
        placeId: "philadelphia",
        reason:
          "보스턴의 저항 뒤 독립 운동이 전개되었고, 필라델피아에서 독립 선언을 채택했다.",
      },
    ],
  },
  {
    id: "world-philadelphia",
    subject: "world",
    placeIds: ["philadelphia", "world-c137ea78cf57"],
    title: "미국 독립 선언과 헌법",
    period: "1776~1787년",
    startYear: 1776,
    endYear: 1787,
    eraIds: ["w-modern"],
    replacesEntryIds: ["w-philadelphia", "world-exp-world-c137ea78cf57-5"],
    summary:
      "필라델피아의 독립기념관에서 독립 선언과 미국 헌법이 논의·채택되었다. 이 건물은 새로운 국가 체제를 정한 회의 장소였다.",
    sources: [
      {
        title: "위키백과 · 독립기념관 (미국)",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%8F%85%EB%A6%BD%EA%B8%B0%EB%85%90%EA%B4%80%20(%EB%AF%B8%EA%B5%AD)&oldid=42570671",
      },
    ],
    related: [
      {
        placeId: "philadelphia",
        fromPlaceIds: ["world-c137ea78cf57"],
        reason:
          "필라델피아의 독립기념관에서 미국 독립 선언과 헌법이 논의·채택되었다.",
      },
      {
        placeId: "world-c137ea78cf57",
        fromPlaceIds: ["philadelphia"],
        reason:
          "필라델피아의 독립기념관에서 미국 독립 선언과 헌법이 논의·채택되었다.",
      },
    ],
  },
  {
    id: "world-paris-revolution",
    subject: "world",
    placeIds: ["paris", "world-897b554f8e5a", "world-2167934c4fca"],
    title: "프랑스 혁명의 시작",
    period: "1789년",
    startYear: 1789,
    endYear: 1799,
    eraIds: ["w-modern"],
    replacesEntryIds: ["w-paris", "world-exp-world-897b554f8e5a-3"],
    summary:
      "파리 시민의 바스티유 감옥 습격은 프랑스 혁명의 시작을 알렸으며, 감옥이 있던 자리는 오늘날 바스티유 광장으로 남아 있다.",
    sources: [
      {
        title: "위키백과 · 바스티유 습격",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%B0%94%EC%8A%A4%ED%8B%B0%EC%9C%A0%20%EC%8A%B5%EA%B2%A9&oldid=40627199",
      },
    ],
  },
  {
    id: "world-manchester",
    subject: "world",
    placeIds: ["manchester"],
    title: "면직물 공업과 산업 혁명",
    period: "18~19세기",
    startYear: 1760,
    endYear: 1850,
    eraIds: ["w-modern"],
    replacesEntryIds: ["w-manchester"],
    summary:
      "기계와 공장이 집중된 면직물 공업 도시로 성장하여 산업 혁명이 생산과 도시 생활을 바꾼 모습을 보여 준다.",
    sources: [
      {
        title: "Historic England · The Industrial Revolution in Manchester",
        url: "https://historicengland.org.uk/content/docs/education/explorer/scheme-of-work-industrial-revolution-manchester-pdf/",
      },
    ],
  },
  {
    id: "world-liverpool",
    subject: "world",
    placeIds: ["world-e927495d0c18"],
    title: "산업 도시를 연결한 철도",
    period: "1830년",
    startYear: 1830,
    eraIds: ["w-modern"],
    summary:
      "맨체스터와 연결한 철도가 개통되어 항구와 공업 도시 사이의 사람·화물 운송을 바꾸었다.",
    sources: [
      {
        title: "Historic England · Liverpool and Manchester Railway",
        url: "https://historicengland.org.uk/listing/heritage-gateway/results/record/40b1668f-44ca-471f-970f-e86d7ea4f9ac/MGM22274",
      },
      {
        title: "Science and Industry Museum · Revolution Manchester",
        url: "https://www.scienceandindustrymuseum.org.uk/sites/default/files/2023-07/2703_REV_MAN_Move-LPG_DIGITAL_AW-compressed.pdf",
      },
    ],
    related: [
      {
        placeId: "manchester",
        reason:
          "1830년 개통한 철도가 항구 리버풀과 공업 도시 맨체스터를 연결했다.",
      },
    ],
  },
  {
    id: "world-vienna",
    subject: "world",
    placeIds: ["world-f42f96d155a5"],
    title: "나폴레옹 이후 유럽 질서",
    period: "1814~1815년",
    startYear: 1814,
    endYear: 1815,
    eraIds: ["w-modern"],
    replacesEntryIds: ["world-exp-world-f42f96d155a5-3"],
    summary:
      "빈 회의에서 유럽 열강이 나폴레옹 전쟁 뒤의 국경과 정치 질서를 다시 정했다.",
    sources: [
      {
        title: "위키백과 · 빈 회의",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%B9%88%20%ED%9A%8C%EC%9D%98&oldid=42425341",
      },
    ],
  },
  {
    id: "world-waterloo",
    subject: "world",
    placeIds: ["world-64d4730780be"],
    title: "나폴레옹의 마지막 패배",
    period: "1815년",
    startYear: 1815,
    eraIds: ["w-modern"],
    summary:
      "나폴레옹이 영국·프로이센 연합군에 패배하면서 백일천하가 끝난 전투 장소이다.",
    sources: [
      {
        title: "위키백과 · 워털루 전투",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%9B%8C%ED%84%B8%EB%A3%A8%20%EC%A0%84%ED%88%AC&oldid=41926242",
      },
    ],
  },
  {
    id: "world-wuchang",
    subject: "world",
    placeIds: ["wuchang"],
    title: "신해혁명의 출발",
    period: "1911년",
    startYear: 1911,
    endYear: 1912,
    eraIds: ["w-modern"],
    replacesEntryIds: ["w-wuchang"],
    summary:
      "우창 봉기가 청 왕조를 무너뜨리는 신해혁명의 계기가 되어 중국의 공화정 수립으로 이어졌다.",
    sources: [
      {
        title: "위키백과 · 우창 봉기",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%9A%B0%EC%B0%BD%20%EB%B4%89%EA%B8%B0&oldid=41504374",
      },
    ],
  },
  {
    id: "world-tokyo-meiji",
    subject: "world",
    placeIds: ["tokyo"],
    displayNames: { tokyo: "도쿄" },
    title: "메이지 정부의 수도",
    period: "1868년 이후",
    startYear: 1868,
    endYear: 1912,
    eraIds: ["w-modern"],
    replacesEntryIds: ["w-tokyo"],
    summary:
      "에도가 도쿄로 이름을 바꾸고 새 정부의 중심이 되어, 메이지 시기의 국가 개혁과 근대화가 추진되었다.",
    sources: [
      {
        title: "위키백과 · 도쿄",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%8F%84%EC%BF%84&oldid=42633246",
      },
    ],
  },
  {
    id: "world-nanjing-treaty",
    subject: "world",
    placeIds: ["nanjing"],
    title: "아편 전쟁과 불평등 조약",
    period: "1842년",
    startYear: 1842,
    eraIds: ["w-modern"],
    summary:
      "청이 제1차 아편 전쟁에서 패한 뒤 난징 조약을 맺어 항구를 열고 홍콩섬을 영국에 넘기게 되었다.",
    sources: [
      {
        title: "위키백과 · 난징 조약",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%82%9C%EC%A7%95%20%EC%A1%B0%EC%95%BD&oldid=39080480",
      },
    ],
    related: [
      {
        placeId: "world-411bda9a20bb",
        reason: "난징 조약에 따라 홍콩섬이 영국에 할양되었다.",
      },
    ],
  },
  {
    id: "world-plassey",
    subject: "world",
    placeIds: ["world-bf7dd6c55d84"],
    title: "영국 동인도 회사의 지배 확대",
    period: "1757년",
    startYear: 1757,
    eraIds: ["w-modern"],
    summary:
      "영국 동인도 회사가 벵골의 군대를 물리쳐 인도에서 정치·경제적 지배를 확대하는 전환점이 되었다.",
    sources: [
      {
        title: "위키백과 · 플라시 전투",
        url: "https://ko.wikipedia.org/w/index.php?title=%ED%94%8C%EB%9D%BC%EC%8B%9C%20%EC%A0%84%ED%88%AC&oldid=41765866",
      },
    ],
  },
  {
    id: "world-adwa",
    subject: "world",
    placeIds: ["world-9f0534311414"],
    title: "에티오피아의 독립 수호",
    period: "1896년",
    startYear: 1896,
    eraIds: ["w-wars"],
    summary:
      "에티오피아군이 이탈리아의 침략군을 물리쳐 독립을 지켜 낸 전투 장소이다.",
    sources: [
      {
        title: "위키백과 · 아두와 전투",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%95%84%EB%91%90%EC%99%80%20%EC%A0%84%ED%88%AC&oldid=42593420",
      },
      {
        title: "Wikipedia · Battle of Adwa",
        url: "https://en.wikipedia.org/wiki/Battle_of_Adwa",
      },
    ],
  },
  {
    id: "world-suez",
    subject: "world",
    placeIds: ["world-2f323ebac563"],
    title: "세계 교역로가 된 운하",
    period: "1869년",
    startYear: 1869,
    eraIds: ["w-wars"],
    summary:
      "지중해와 홍해를 연결하여 유럽과 아시아 사이의 항로를 단축하고 제국주의 열강의 전략적 관심을 끌었다.",
    sources: [
      {
        title: "위키백과 · 수에즈 운하",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%88%98%EC%97%90%EC%A6%88%20%EC%9A%B4%ED%95%98&oldid=41691133",
      },
    ],
  },
  {
    id: "world-sarajevo",
    subject: "world",
    placeIds: ["sarajevo"],
    title: "제1차 세계 대전의 도화선",
    period: "1914년",
    startYear: 1914,
    eraIds: ["w-wars"],
    replacesEntryIds: ["w-sarajevo", "world-exp-sarajevo-4"],
    summary:
      "오스트리아·헝가리 황태자 부부가 암살되었고, 이 사건 뒤 열강 간의 충돌이 세계 대전으로 확대되었다.",
    sources: [
      {
        title: "위키백과 · 사라예보 사건",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%82%AC%EB%9D%BC%EC%98%88%EB%B3%B4%20%EC%82%AC%EA%B1%B4&oldid=41606690",
      },
    ],
  },
  {
    id: "world-verdun",
    subject: "world",
    placeIds: ["world-bf1bef5d11c6"],
    title: "장기 소모전과 참호전",
    period: "1916년",
    startYear: 1916,
    eraIds: ["w-wars"],
    summary:
      "프랑스군과 독일군이 장기간 싸우며 막대한 희생을 치러, 제1차 세계 대전의 소모전을 상징하는 곳이 되었다.",
    sources: [
      {
        title: "위키백과 · 베르됭 전투",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%B2%A0%EB%A5%B4%EB%90%AD%20%EC%A0%84%ED%88%AC&oldid=42527047",
      },
    ],
  },
  {
    id: "world-petrograd",
    subject: "world",
    placeIds: ["world-576d4303e8a4"],
    title: "러시아 혁명과 정권 교체",
    period: "1917년",
    startYear: 1917,
    eraIds: ["w-wars"],
    summary:
      "당시 페트로그라드라 불린 이 도시에서 혁명이 일어나 차르 체제가 무너지고 볼셰비키가 권력을 잡았다.",
    sources: [
      {
        title: "위키백과 · 러시아 혁명",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%9F%AC%EC%8B%9C%EC%95%84%20%ED%98%81%EB%AA%85&oldid=42439629",
      },
    ],
  },
  {
    id: "world-versailles-treaty",
    subject: "world",
    placeIds: ["versailles", "world-0b5aaef85c9c"],
    title: "제1차 세계 대전 뒤의 평화 조약",
    period: "1919년",
    startYear: 1919,
    eraIds: ["w-wars"],
    replacesEntryIds: ["w-versailles"],
    summary:
      "베르사유의 궁전에서 체결된 베르사유 조약은 독일의 군비와 영토·배상 의무를 정하여, 제1차 세계 대전 뒤 국제 질서의 한 축을 마련했다.",
    sources: [
      {
        title: "위키백과 · 베르사유 조약",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%B2%A0%EB%A5%B4%EC%82%AC%EC%9C%A0%20%EC%A1%B0%EC%95%BD&oldid=42619210",
      },
    ],
  },
  {
    id: "world-amritsar",
    subject: "world",
    placeIds: ["world-b31b784884b5"],
    title: "식민 통치에 대한 저항의 확대",
    period: "1919년",
    startYear: 1919,
    eraIds: ["w-wars"],
    summary:
      "영국군이 잘리안왈라 바그의 군중에게 발포한 학살 사건이 일어나 인도의 반영 독립 운동에 큰 영향을 주었다.",
    sources: [
      {
        title: "위키백과 · 암리차르 학살",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%95%94%EB%A6%AC%EC%B0%A8%EB%A5%B4%20%ED%95%99%EC%82%B4&oldid=42349252",
      },
    ],
  },
  {
    id: "world-dandi",
    subject: "world",
    placeIds: ["world-9d6a74a1d2fc"],
    title: "간디의 소금 행진",
    period: "1930년",
    startYear: 1930,
    eraIds: ["w-wars"],
    replacesEntryIds: ["world-exp-world-9d6a74a1d2fc-4"],
    summary:
      "간디가 바닷가에서 소금을 만들며 영국의 소금 독점에 저항하여, 비폭력 시민 불복종 운동을 널리 알렸다.",
    sources: [
      {
        title: "위키백과 · 소금 행진",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%86%8C%EA%B8%88%20%ED%96%89%EC%A7%84&oldid=42460659",
      },
    ],
  },
  {
    id: "world-nanjing-massacre",
    subject: "world",
    placeIds: ["nanjing"],
    title: "일본군의 점령과 민간인 학살",
    period: "1937년",
    startYear: 1937,
    endYear: 1938,
    eraIds: ["w-wars"],
    replacesEntryIds: ["w-nanjing"],
    summary:
      "중일 전쟁 중 일본군이 점령한 뒤 대규모 민간인 학살과 폭력이 벌어진 곳이다.",
    sources: [
      {
        title: "위키백과 · 난징 대학살",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%82%9C%EC%A7%95%20%EB%8C%80%ED%95%99%EC%82%B4&oldid=42622629",
      },
    ],
  },
  {
    id: "world-auschwitz",
    subject: "world",
    placeIds: ["world-f4a4b13bb004", "world-0087126c8947"],
    title: "나치의 조직적 학살",
    period: "1940~1945년",
    startYear: 1940,
    endYear: 1945,
    eraIds: ["w-wars"],
    summary:
      "나치 독일은 점령한 폴란드의 오시비엥침에 아우슈비츠 수용소를 설치했다. 유대인 등을 강제 수용하고 대량 학살한 수용소는 홀로코스트의 참상을 증언한다.",
    sources: [
      {
        title: "위키백과 · 아우슈비츠 강제 수용소",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%95%84%EC%9A%B0%EC%8A%88%EB%B9%84%EC%B8%A0%20%EA%B0%95%EC%A0%9C%20%EC%88%98%EC%9A%A9%EC%86%8C&oldid=42142450",
      },
    ],
  },
  {
    id: "world-stalingrad",
    subject: "world",
    placeIds: ["world-b43bdda051da"],
    displayNames: { "world-b43bdda051da": "스탈린그라드" },
    title: "독소 전쟁의 전환점",
    period: "1942~1943년",
    startYear: 1942,
    endYear: 1943,
    eraIds: ["w-wars"],
    summary:
      "당시 스탈린그라드에서 소련군이 독일군을 포위해 승리하면서 독소 전쟁의 흐름이 크게 바뀌었다.",
    sources: [
      {
        title: "위키백과 · 스탈린그라드 전투",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%8A%A4%ED%83%88%EB%A6%B0%EA%B7%B8%EB%9D%BC%EB%93%9C%20%EC%A0%84%ED%88%AC&oldid=42330848",
      },
    ],
  },
  {
    id: "world-hiroshima",
    subject: "world",
    placeIds: ["hiroshima"],
    title: "원자 폭탄과 전쟁의 피해",
    period: "1945년",
    startYear: 1945,
    eraIds: ["w-wars"],
    replacesEntryIds: ["w-hiroshima"],
    summary:
      "1945년 8월 6일 미국이 원자 폭탄을 투하하여 막대한 인명 피해가 발생한 도시이다.",
    sources: [
      {
        title: "위키백과 · 히로시마·나가사키 원자폭탄 투하",
        url: "https://ko.wikipedia.org/w/index.php?title=%ED%9E%88%EB%A1%9C%EC%8B%9C%EB%A7%88%C2%B7%EB%82%98%EA%B0%80%EC%82%AC%ED%82%A4%20%EC%9B%90%EC%9E%90%ED%8F%AD%ED%83%84%20%ED%88%AC%ED%95%98&oldid=42634160",
      },
    ],
  },
  {
    id: "world-potsdam",
    subject: "world",
    placeIds: ["world-ae6d96814fa0"],
    title: "제2차 세계 대전의 전후 처리",
    period: "1945년",
    startYear: 1945,
    eraIds: ["w-wars"],
    summary:
      "연합국 지도자들이 모여 패전한 독일의 처리 등 전후 문제를 논의한 회담이 열린 곳이다.",
    sources: [
      {
        title: "위키백과 · 포츠담 회담",
        url: "https://ko.wikipedia.org/w/index.php?title=%ED%8F%AC%EC%B8%A0%EB%8B%B4%20%ED%9A%8C%EB%8B%B4&oldid=41488065",
      },
    ],
  },
  {
    id: "world-berlin",
    subject: "world",
    placeIds: ["berlin", "world-c872e9e66032", "world-d793382e90f0"],
    title: "분단과 냉전의 상징",
    period: "1961~1990년",
    startYear: 1961,
    endYear: 1990,
    eraIds: ["w-contemporary"],
    replacesEntryIds: ["w-berlin"],
    summary:
      "베를린에서는 동서를 갈라놓은 장벽의 통행이 1989년에 열렸다. 같은 해 브란덴부르크 문도 다시 통행할 수 있게 되었고, 이듬해 독일의 통일과 함께 냉전 종식을 상징하게 되었다.",
    sources: [
      {
        title: "위키백과 · 베를린 장벽",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%B2%A0%EB%A5%BC%EB%A6%B0%20%EC%9E%A5%EB%B2%BD&oldid=42621093",
      },
      {
        title: "베를린시 · 베를린 장벽의 개방과 붕괴",
        url: "https://www.berlin.de/en/history/8482274-8619314-opening-and-fall-of-the-berlin-wall.en.html",
      },
    ],
  },
  {
    id: "world-bandung",
    subject: "world",
    placeIds: ["bandung"],
    title: "아시아·아프리카의 연대",
    period: "1955년",
    startYear: 1955,
    eraIds: ["w-contemporary"],
    replacesEntryIds: ["w-bandung", "world-exp-bandung-5"],
    summary:
      "아시아·아프리카 국가들이 모여 식민주의에 반대하고 평화 공존과 협력을 논의한 회의가 열렸다.",
    sources: [
      {
        title: "미국 국무부 역사실 · The Bandung Conference, 1955",
        url: "https://history.state.gov/milestones/1953-1960/bandung-conf",
      },
      {
        title: "위키백과 · 반둥 회의",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%B0%98%EB%91%A5%20%ED%9A%8C%EC%9D%98&oldid=40118182",
      },
    ],
  },
  {
    id: "world-dienbienphu",
    subject: "world",
    placeIds: ["world-5ac0fb3528de"],
    title: "프랑스 식민 지배를 흔든 승리",
    period: "1954년",
    startYear: 1954,
    eraIds: ["w-contemporary"],
    summary:
      "베트민이 프랑스군을 물리쳐 제1차 인도차이나 전쟁을 끝내는 협상으로 이어진 전투 장소이다.",
    sources: [
      {
        title: "위키백과 · 디엔비엔푸 전투",
        url: "https://ko.wikipedia.org/w/index.php?title=%EB%94%94%EC%97%94%EB%B9%84%EC%97%94%ED%91%B8%20%EC%A0%84%ED%88%AC&oldid=41493962",
      },
    ],
  },
  {
    id: "world-havana",
    subject: "world",
    placeIds: ["world-ce7086ea96e3"],
    title: "쿠바 혁명 이후의 수도",
    period: "1959년",
    startYear: 1959,
    endYear: 1959,
    eraIds: ["w-contemporary"],
    summary:
      "바티스타 정권을 무너뜨린 혁명군이 1959년 1월 입성하면서 쿠바 혁명으로 세워진 새 정권의 중심지가 되었다.",
    sources: [
      {
        title: "위키백과 · 쿠바 혁명",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%BF%A0%EB%B0%94%20%ED%98%81%EB%AA%85&oldid=39110939",
      },
    ],
  },
  {
    id: "world-prague",
    subject: "world",
    placeIds: ["world-845a3fde2ab5"],
    title: "개혁과 소련의 군사 개입",
    period: "1968년",
    startYear: 1968,
    eraIds: ["w-contemporary"],
    summary:
      "체코슬로바키아의 자유화 개혁이 추진되었으나 바르샤바 조약 기구 군대의 개입으로 좌절되었다.",
    sources: [
      {
        title: "위키백과 · 프라하의 봄",
        url: "https://ko.wikipedia.org/w/index.php?title=%ED%94%84%EB%9D%BC%ED%95%98%EC%9D%98%20%EB%B4%84&oldid=42450183",
      },
    ],
  },
  {
    id: "world-accra",
    subject: "world",
    placeIds: ["world-09e4cb92eb23"],
    title: "가나의 독립과 탈식민화",
    period: "1957년",
    startYear: 1957,
    eraIds: ["w-contemporary"],
    summary:
      "가나가 영국의 식민 지배에서 독립한 뒤 수도가 되어, 아프리카 탈식민화의 흐름을 보여 준다.",
    sources: [
      {
        title: "위키백과 · 가나",
        url: "https://ko.wikipedia.org/w/index.php?title=%EA%B0%80%EB%82%98&oldid=42069643",
      },
    ],
  },
  {
    id: "world-addis",
    subject: "world",
    placeIds: ["world-ae061c68c10a"],
    title: "아프리카 국가들의 협력",
    period: "1963년 이후",
    startYear: 1963,
    endYear: 2002,
    eraIds: ["w-contemporary"],
    summary:
      "아프리카 단결 기구가 창설된 도시로, 이후 아프리카 연합 본부가 자리한 대륙 협력의 중심지가 되었다.",
    sources: [
      {
        title: "위키백과 · 아프리카 단결 기구",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%95%84%ED%94%84%EB%A6%AC%EC%B9%B4%20%EB%8B%A8%EA%B2%B0%20%EA%B8%B0%EA%B5%AC&oldid=39107323",
      },
      {
        title: "위키백과 · 아프리카 연합",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%95%84%ED%94%84%EB%A6%AC%EC%B9%B4%20%EC%97%B0%ED%95%A9&oldid=40855871",
      },
    ],
  },
  {
    id: "world-chernobyl",
    subject: "world",
    placeIds: ["world-7589ffc5a3f3"],
    title: "국경을 넘은 원전 사고",
    period: "1986년",
    startYear: 1986,
    eraIds: ["w-contemporary"],
    summary:
      "인근 원자력 발전소 사고의 방사성 물질이 여러 나라로 퍼져, 원전 안전과 환경 문제를 국제적 과제로 드러냈다.",
    sources: [
      {
        title: "위키백과 · 체르노빌 원자력 발전소 사고",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%B2%B4%EB%A5%B4%EB%85%B8%EB%B9%8C%20%EC%9B%90%EC%9E%90%EB%A0%A5%20%EB%B0%9C%EC%A0%84%EC%86%8C%20%EC%82%AC%EA%B3%A0&oldid=42548330",
      },
    ],
  },
  {
    id: "world-suez-crisis",
    subject: "world",
    placeIds: ["world-2f323ebac563"],
    title: "운하 국유화와 수에즈 위기",
    period: "1956년",
    startYear: 1956,
    eraIds: ["w-contemporary"],
    summary:
      "이집트의 운하 국유화 뒤 영국·프랑스·이스라엘이 군사 행동에 나서면서 탈식민화와 냉전이 충돌한 무대가 되었다.",
    sources: [
      {
        title: "위키백과 · 수에즈 위기",
        url: "https://ko.wikipedia.org/w/index.php?title=%EC%88%98%EC%97%90%EC%A6%88%20%EC%9C%84%EA%B8%B0&oldid=41539389",
      },
    ],
  },
  {
    id: "world-australia-colonisation",
    subject: "world",
    placeIds: ["world-182a68a37544"],
    title: "영국의 식민화와 원주민의 삶",
    period: "1788년 이후",
    startYear: 1788,
    eraIds: ["w-modern"],
    summary:
      "영국이 시드니 코브에 죄수 유배지를 세우며 식민화를 시작했다. 이후 정착 확대와 충돌·질병은 원주민의 삶과 문화에 큰 피해를 주었다.",
    sources: [
      {
        title: "호주 국립박물관 · 제1함대의 시드니 코브 도착",
        url: "https://digital-classroom.nma.gov.au/defining-moments/first-fleet-arrives-sydney-cove",
      },
    ],
  },
  {
    id: "world-australia-federation",
    subject: "world",
    placeIds: ["world-182a68a37544"],
    title: "여섯 식민지가 연방을 이루다",
    period: "1901년",
    startYear: 1901,
    eraIds: ["w-modern"],
    summary:
      "여섯 영국 식민지가 오스트레일리아 연방을 이루고 각 주와 연방 정부가 권한을 나누게 되었다. 영국 군주를 국가 원수로 유지하면서 자치의 범위를 넓혔다.",
    sources: [
      {
        title: "호주 국립박물관 · 오스트레일리아 식민지의 연방 성립",
        url: "https://digital-classroom.nma.gov.au/defining-moments/federation-australian-colonies",
      },
    ],
  },
  {
    id: "world-canberra",
    subject: "world",
    placeIds: ["world-953c761e000b"],
    title: "연방을 위한 새 수도",
    period: "1908~1927년",
    startYear: 1908,
    endYear: 1927,
    eraIds: ["w-modern", "w-wars"],
    unitId: "world-nations",
    summary:
      "시드니와 멜버른의 경쟁 속에서 새 연방 수도로 선정되었다. 1913년 캔버라라는 이름을 정했고, 1927년 연방 의회가 옮겨 와 정치 중심지가 되었다.",
    sources: [
      {
        title: "호주 국가수도청 · 캔버라의 선정과 명명",
        url: "https://www.nca.gov.au/education/canberras-history/siting-and-naming-canberra",
      },
      {
        title: "호주 국가수도청 · 정부 소재지 캔버라",
        url: "https://www.nca.gov.au/education/canberras-history/canberra-seat-government",
      },
    ],
    related: [
      {
        placeId: "world-182a68a37544",
        reason:
          "캔버라는 1901년 성립한 오스트레일리아 연방의 정부와 의회를 위한 새 수도로 건설되었다.",
      },
    ],
  },
  {
    id: "world-new-zealand-waitangi",
    subject: "world",
    placeIds: ["world-38cc49cb4793"],
    title: "와이탕이 조약과 통치권 논쟁",
    period: "1840년",
    startYear: 1840,
    eraIds: ["w-modern"],
    summary:
      "와이탕이에서 마오리 지도자들과 영국 왕실 대표가 조약을 맺었다. 영어본과 마오리어본의 차이는 영국의 통치권과 마오리의 권한을 둘러싼 해석 갈등으로 이어졌다.",
    sources: [
      {
        title: "뉴질랜드 문화유산부 · 와이탕이 조약의 서명",
        url: "https://nzhistory.govt.nz/the-treaty-of-waitangi-is-signed",
      },
      {
        title: "뉴질랜드 문화유산부 · 조약의 두 언어본 사이의 차이",
        url: "https://nzhistory.govt.nz/page/differences-between-texts",
      },
    ],
  },
  {
    id: "world-new-zealand-suffrage",
    subject: "world",
    placeIds: ["world-38cc49cb4793"],
    title: "여성의 의회 선거권 인정",
    period: "1893년",
    startYear: 1893,
    eraIds: ["w-modern"],
    summary:
      "여성들의 청원과 참정권 운동 끝에 선거법을 개정하여, 자치 국가 가운데 세계 최초로 여성의 의회 선거 투표권을 인정했다.",
    sources: [
      {
        title: "뉴질랜드 문화유산부 · 여성과 선거권",
        url: "https://nzhistory.govt.nz/politics/womens-suffrage",
      },
      {
        title: "뉴질랜드 문화유산부 · 여성 참정권 운동의 역사",
        url: "https://nzhistory.govt.nz/politics/womens-suffrage/brief-history",
      },
    ],
  },
  {
    id: "world-wellington",
    subject: "world",
    placeIds: ["world-72e73261214b"],
    title: "남북을 잇는 수도로의 이전",
    period: "1865년",
    startYear: 1865,
    eraIds: ["w-modern"],
    summary:
      "남섬의 성장과 오클랜드까지의 긴 이동 거리를 고려하여 수도와 의회가 옮겨 왔다. 이후 뉴질랜드 중앙 정부의 중심지가 되었다.",
    sources: [
      {
        title: "뉴질랜드 문화유산부 · 웰링턴에서 열린 의회",
        url: "https://nzhistory.govt.nz/parliament-meets-wellington",
      },
    ],
    related: [
      {
        placeId: "world-38cc49cb4793",
        reason:
          "웰링턴은 1865년 뉴질랜드의 수도와 의회가 이전한 뒤 중앙 정치의 중심지가 되었다.",
      },
    ],
  },
  {
    id: "world-hawaii-annexation",
    subject: "world",
    placeIds: ["world-f6175f1c152e"],
    title: "왕국의 붕괴와 미국의 병합",
    period: "1893~1898년",
    startYear: 1893,
    endYear: 1898,
    eraIds: ["w-modern"],
    summary:
      "미국 해병대의 지원을 받은 세력이 1893년 왕정을 무너뜨렸고, 원주민의 반대 청원에도 1898년 미국에 병합되어 태평양으로의 제국주의 팽창을 보여 준다.",
    sources: [
      {
        title: "미국 국립공원관리청 · 이올라니 궁전과 하와이의 역사",
        url: "https://www.nps.gov/articles/000/iolani-palace-a-hawaiian-place-of-history-power-and-prestige.htm",
      },
    ],
  },
  {
    id: "world-pearl-harbor",
    subject: "world",
    placeIds: ["world-d9f7ef39a0f0"],
    title: "일본의 기습과 미국의 참전",
    period: "1941년 12월",
    startYear: 1941,
    eraIds: ["w-wars"],
    summary:
      "일본이 12월 7일 하와이의 미국 태평양 함대 기지를 기습했다. 이 공격은 미국이 일본에 선전 포고하고 제2차 세계 대전에 본격적으로 참전하는 계기가 되었다.",
    sources: [
      {
        title: "미국 국립공원관리청 · 진주만 공격",
        url: "https://www.nps.gov/wwii/learn/historyculture/pearl-harbor.htm",
      },
    ],
  },
  {
    id: "world-midway",
    subject: "world",
    placeIds: ["world-ae7750306be7"],
    title: "태평양 전쟁의 흐름을 바꾼 해전",
    period: "1942년 6월",
    startYear: 1942,
    eraIds: ["w-wars"],
    summary:
      "일본의 공격 계획을 암호 해독으로 파악한 미국이 부근 해전에서 일본 항공모함 4척을 격침하여, 태평양 전쟁의 중요한 전환점이 되었다.",
    sources: [
      {
        title: "미국 국립공원관리청 · 미드웨이의 제2차 세계 대전 유적",
        url: "https://www.nps.gov/articles/world-war-ii-facilities-at-midway.htm",
      },
    ],
    related: [
      {
        placeId: "world-d9f7ef39a0f0",
        reason:
          "진주만 공격에 참가한 일본 항공모함 4척은 이듬해 미드웨이 해전에서 침몰했다.",
      },
    ],
  },
];
