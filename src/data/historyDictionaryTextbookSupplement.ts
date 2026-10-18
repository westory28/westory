import type { HistoryDictionaryTextbookReview } from "./historyDictionaryTextbookTypes";

/** Foundational concepts and unexplained terms checked against institutions. */
export const historyDictionaryTextbookSupplementReviews: HistoryDictionaryTextbookReview[] =
  [
    {
      word: "전국 시대(일본)",
      definition:
        "15세기 후반부터 일본의 중앙 통치력이 약해지면서 여러 다이묘가 세력을 다투던 시기이다. 16세기 후반 통일이 진행되었으며, 중국의 춘추 전국 시대와 구별한다.",
      aliases: ["일본 전국 시대", "센고쿠 시대", "전국 시대"],
      facetIds: [
        "subject:world",
        "era:w-medieval",
        "era:w-early-modern",
        "topic:political-events",
      ],
      sources: [{ book: "history2", pdfPage: 110, printedPage: 112 }],
      externalSources: [
        {
          title: "나라현 공식 관광 안내 · History — Sengoku",
          author: "일본 나라현",
          url: "https://www.visitnara.jp/history/",
          changes:
            "일본 전국 시대의 정치적 배경을 확인하여 한국어 학습용 풀이를 새로 작성",
          retrievedAt: "2026-10-18",
        },
      ],
    },
    {
      word: "권리 청원",
      definition:
        "1628년 영국 의회가 찰스 1세에게 제출한 문서이다. 의회의 동의 없는 과세와 법적 근거 없는 구금을 금지하도록 요구하여 왕의 권력을 제한하려 하였다.",
      aliases: ["Petition of Right"],
      facetIds: ["subject:world", "era:w-modern", "topic:law"],
      sources: [{ book: "history2", pdfPage: 111, printedPage: 113 }],
      externalSources: [
        {
          title: "영국 의회 · The Petition of Right",
          author: "UK Parliament · Parliamentary Archives",
          url: "https://www.parliament.uk/about/living-heritage/evolutionofparliament/parliamentaryauthority/civilwar/collections/petition-of-right/",
          changes:
            "원문 기록의 연도와 요구 사항을 확인하여 한국어 학습용 풀이를 새로 작성",
          retrievedAt: "2026-10-18",
        },
      ],
    },
    ...(
      [
        [
          "역사",
          "과거에 실제로 일어난 일과 그 일을 조사하여 남긴 기록을 뜻한다. 기록에는 작성자의 관점과 해석이 담길 수 있다.",
          8,
        ],
        [
          "사료 비판",
          "역사 자료가 언제 누구에 의해 만들어졌는지, 내용은 믿을 만한지 살피는 일이다. 다른 자료와 비교하여 잘못되거나 꾸며진 부분을 가려낸다.",
          10,
        ],
        [
          "역사 서술",
          "여러 사료를 조사하고 해석한 결과를 바탕으로 과거의 사건과 그 의미를 글로 정리하는 일이다.",
          10,
        ],
        [
          "연표",
          "역사적 사건을 시간 순서에 따라 정리한 표이다. 사건의 흐름을 살피고 같은 시기 여러 지역의 일을 비교할 때 쓴다.",
          11,
        ],
        [
          "문헌 자료",
          "책·편지·비문처럼 글로 남겨진 역사 자료이다. 만들어진 시기와 글쓴이의 의도를 살피면서 내용을 읽어야 한다.",
          11,
        ],
        [
          "역사 지도",
          "특정 시대의 영역이나 사건의 전개를 지도에 나타낸 자료이다. 범례와 선·화살표를 보며 세력의 범위와 이동 경로를 읽는다.",
          11,
        ],
        [
          "기원전",
          "예수의 탄생을 기준으로 삼은 서기에서 기준이 되는 해보다 앞선 시기를 가리킨다. B.C.로 줄여 쓰기도 한다.",
          11,
        ],
        [
          "기원후",
          "예수의 탄생을 기준으로 삼은 서기에서 기준이 되는 해부터의 시기를 가리킨다. A.D.로 줄여 쓰거나 연도만 쓰기도 한다.",
          11,
        ],
      ] as [string, string, number][]
    ).map(([word, definition, page]) => ({
      word,
      definition,
      aliases:
        word === "기원전"
          ? ["B.C.", "BC"]
          : word === "기원후"
            ? ["A.D.", "AD"]
            : [],
      facetIds: [
        "subject:korea",
        "subject:world",
        "era:common",
        "topic:education",
      ],
      sources: [{ book: "atlas" as const, pdfPage: page, printedPage: page }],
    })),
    {
      word: "사료",
      definition:
        "과거의 생활과 사건을 알아보는 데 쓰는 자료이다. 옛 기록뿐 아니라 유물·유적·사진·구술도 포함하며, 누가 언제 왜 남겼는지 살펴보고 다른 자료와 비교해야 한다.",
      aliases: ["역사 자료"],
      facetIds: [
        "subject:korea",
        "subject:world",
        "era:common",
        "topic:education",
      ],
      sources: [{ book: "atlas", pdfPage: 10, printedPage: 10 }],
      externalSources: [
        {
          title: "사료, 『한국민족문화대백과사전』",
          author: "한국학중앙연구원",
          url: "https://encykorea.aks.ac.kr/Article/E0025532",
          license: "공공저작물 자유이용 · 출처 표시",
          licenseUrl: "https://encykorea.aks.ac.kr/Guide/ContentUse",
          changes: "사료의 종류와 검증 방법을 확인하여 학습용 설명을 새로 작성",
          retrievedAt: "2026-10-18",
        },
      ],
    },
    {
      word: "사르디스",
      matchId: "catalog-place-world-bce22ab2c1ce",
      kind: "place",
      definition:
        "오늘날 튀르키예 서부에 있던 리디아 왕국의 수도이다. 금과 화폐 주조로 번영했으며, 리디아 멸망 뒤에도 페르시아 등 여러 제국의 중요한 도시로 남았다.",
      aliases: ["사르데이스"],
      facetIds: [
        "subject:world",
        "era:w-ancient",
        "region:asia-west",
        "topic:site",
      ],
      sources: [{ book: "atlas", pdfPage: 16, printedPage: 16 }],
      externalSources: [
        {
          title:
            "UNESCO 세계유산센터 · Sardis and the Lydian Tumuli of Bin Tepe",
          author: "UNESCO 세계유산센터",
          url: "https://whc.unesco.org/en/list/1731/",
          license: "CC BY-SA 3.0 IGO",
          licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/igo/",
          changes: "영문 설명을 한국어로 번역·요약하고 중학생 수준으로 재구성",
          retrievedAt: "2026-10-18",
        },
      ],
    },
    {
      word: "파탈리푸트라",
      matchId: "catalog-place-world-eccf638c9772",
      kind: "place",
      definition:
        "오늘날 인도 파트나에 있던 고대 도시이다. 마우리아 왕조와 굽타 왕조의 수도로, 아소카왕 등이 이곳을 중심으로 나라를 다스렸다.",
      aliases: [],
      facetIds: [
        "subject:world",
        "era:w-ancient",
        "era:w-medieval",
        "region:asia-south",
        "topic:site",
      ],
      sources: [
        { book: "atlas", pdfPage: 18, printedPage: 19 },
        { book: "atlas", pdfPage: 23, printedPage: 25 },
      ],
      externalSources: [
        {
          title: "인도 비하르주 파트나 지구 · History",
          author: "District Patna, Government of Bihar",
          url: "https://patna.nic.in/history/",
          changes: "고대 수도의 위치와 왕조를 확인하여 학습용 설명을 새로 작성",
          retrievedAt: "2026-10-18",
        },
      ],
    },
    ...["kr-d8099a7f96a4", "world-d8099a7f96a4"].map(
      (placeId): HistoryDictionaryTextbookReview => ({
        word: "카슈가르",
        matchId: `catalog-place-${placeId}`,
        kind: "place",
        definition:
          "파미르 고원 동쪽, 오늘날 중국 신장에 있는 도시이다. 비단길을 오가는 상인들이 모여 물건을 거래하던 오아시스 교역의 중심지였다.",
        aliases: ["소륵", "카스"],
        facetIds: [
          "subject:world",
          "era:w-ancient",
          "era:w-medieval",
          "region:asia-east",
          "topic:settlement",
        ],
        sources: [
          { book: "atlas", pdfPage: 19, printedPage: 20 },
          { book: "atlas", pdfPage: 19, printedPage: 21 },
          { book: "atlas", pdfPage: 24, printedPage: 26 },
        ],
        externalSources: [
          {
            title: "UNESCO · On the Silk Roads — The Desert Route Expedition",
            author: "UNESCO 실크로드 프로그램",
            url: "https://www.unesco.org/archives/multimedia/document-4583",
            changes:
              "파미르 기슭의 위치와 옛 비단길의 상업 중심지였음을 확인하여 풀이 보완",
            retrievedAt: "2026-10-18",
          },
        ],
      }),
    ),
  ];
