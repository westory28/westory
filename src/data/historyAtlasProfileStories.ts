import type { AtlasHistoricalStory } from "../lib/historyAtlasStories";

/**
 * Historical statements already sourced in the place profiles, individually
 * checked for an explicit period and a predicate about this place itself.
 * This is a static snapshot: no runtime keyword inference or profile lookup.
 *
 * When a source gives only an era, startYear/endYear are broad sorting bounds,
 * never claimed construction, foundation, or abandonment dates for the place.
 * The displayed period and summary retain the source's precision/uncertainty.
 * Sources retain their revision links, translation notices, and CC attribution.
 * Related places occur explicitly in that same statement; proximity is unused.
 */
export const profileHistoricalStories: AtlasHistoricalStory[] = [
  {
    id: "profile-kr-060a1c8b5d1a",
    subject: "korea",
    placeIds: ["kr-060a1c8b5d1a"],
    title: "백제 초기의 수도",
    period: "삼국 시대",
    startYear: -57,
    endYear: 668,
    eraIds: ["k-three-kingdoms"],
    summary: "위례성은 백제 초기의 수도이다.",
    sources: [
      {
        title: "위키백과 기여자 · 위례성 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=42605537",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-91751bb0167f",
        reason: "위례성은 백제 초기의 수도이다.",
      },
    ],
  },
  {
    id: "profile-kr-8ec5b3322668",
    subject: "korea",
    placeIds: ["kr-8ec5b3322668"],
    title: "한성백제의 무덤 문화",
    period: "삼국 시대",
    startYear: -57,
    endYear: 668,
    eraIds: ["k-three-kingdoms"],
    summary:
      "서울 송파구에 남아 있는 백제 초기의 무덤들로, 한성백제의 장례 문화를 보여 준다.",
    sources: [
      {
        title: "위키백과 기여자 · 서울 석촌동 고분군 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41872294",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-91751bb0167f",
        reason:
          "서울 송파구에 남아 있는 백제 초기의 무덤들로, 한성백제의 장례 문화를 보여 준다.",
      },
    ],
  },
  {
    id: "profile-kr-43c62744a4f4",
    subject: "korea",
    placeIds: ["kr-43c62744a4f4"],
    title: "신라의 궁궐을 보호한 왕성",
    period: "삼국 시대",
    startYear: -57,
    endYear: 668,
    eraIds: ["k-three-kingdoms"],
    summary:
      "경상북도 경주시 인왕동에 있는 삼국시대 신라의 궁궐을 보호하는 성곽. 왕성.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 경주 월성",
        url: "https://encykorea.aks.ac.kr/Article/E0002909",
      },
    ],
    related: [
      {
        placeId: "kr-e9c99a172d2b",
        reason:
          "경상북도 경주시 인왕동에 있는 삼국시대 신라의 궁궐을 보호하는 성곽. 왕성.",
      },
    ],
  },
  {
    id: "profile-kr-bf866067d9d9",
    subject: "korea",
    placeIds: ["kr-bf866067d9d9"],
    title: "고구려의 벽화 고분",
    period: "삼국 시대",
    startYear: -57,
    endYear: 668,
    eraIds: ["k-three-kingdoms"],
    summary: "강서대묘는 남포특별시 강서구역에 있는 고구려의 벽화 고분이다.",
    sources: [
      {
        title: "위키백과 기여자 · 강서대묘 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=39179561",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-0ee1f40ad364",
        reason: "강서대묘는 남포특별시 강서구역에 있는 고구려의 벽화 고분이다.",
      },
    ],
  },
  {
    id: "profile-kr-987562e4894b",
    subject: "korea",
    placeIds: ["kr-987562e4894b"],
    title: "고구려가 쌓은 성",
    period: "삼국 시대",
    startYear: -57,
    endYear: 668,
    eraIds: ["k-three-kingdoms"],
    summary: "개모성은 중국 랴오닝성 심양시에 위치한 고구려 때 축조된 성이다.",
    sources: [
      {
        title: "위키백과 기여자 · 개모성 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=39760311",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-0ee1f40ad364",
        reason:
          "개모성은 중국 랴오닝성 심양시에 위치한 고구려 때 축조된 성이다.",
      },
    ],
  },
  {
    id: "profile-kr-1496f1fad6f2",
    subject: "korea",
    placeIds: ["kr-1496f1fad6f2"],
    title: "안시성 전투가 일어난 산성",
    period: "삼국 시대",
    startYear: -57,
    endYear: 668,
    eraIds: ["k-three-kingdoms"],
    summary:
      "안시성은 삼국시대에 고구려와 당나라의 경계에 있던 산성으로 안시성 전투가 일어난 곳이다.",
    sources: [
      {
        title: "위키백과 기여자 · 안시성 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41618500",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-0ee1f40ad364",
        reason:
          "안시성은 삼국시대에 고구려와 당나라의 경계에 있던 산성으로 안시성 전투가 일어난 곳이다.",
      },
    ],
  },
  {
    id: "profile-kr-dceb99e842fa",
    subject: "korea",
    placeIds: ["kr-dceb99e842fa"],
    title: "고구려의 도성",
    period: "삼국 시대",
    startYear: -57,
    endYear: 668,
    eraIds: ["k-three-kingdoms"],
    summary: "북한 평양직할시에 있는 삼국시대 고구려의 성곽. 도성.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 평양성",
        url: "https://encykorea.aks.ac.kr/Article/E0059975",
      },
    ],
    related: [
      {
        placeId: "kr-0ee1f40ad364",
        reason: "북한 평양직할시에 있는 삼국시대 고구려의 성곽. 도성.",
      },
    ],
  },
  {
    id: "profile-kr-854e13c825f1",
    subject: "korea",
    placeIds: ["kr-854e13c825f1"],
    title: "압록강 하구의 고구려 성곽",
    period: "삼국 시대",
    startYear: -57,
    endYear: 668,
    eraIds: ["k-three-kingdoms"],
    summary: "압록강 하구에 있는 삼국시대 고구려의 성곽.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 박작성",
        url: "https://encykorea.aks.ac.kr/Article/E0021100",
      },
    ],
    related: [
      {
        placeId: "kr-0ee1f40ad364",
        reason: "압록강 하구에 있는 삼국시대 고구려의 성곽.",
      },
    ],
  },
  {
    id: "profile-kr-34558ba7b4ba",
    subject: "korea",
    placeIds: ["kr-34558ba7b4ba"],
    title: "고구려의 산성",
    period: "삼국 시대",
    startYear: -57,
    endYear: 668,
    eraIds: ["k-three-kingdoms"],
    summary: "건안성은 중국 요령성 영구시 개주시에 위치한 고구려의 산성이다.",
    sources: [
      {
        title: "위키백과 기여자 · 건안성 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41261867",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-0ee1f40ad364",
        reason:
          "건안성은 중국 요령성 영구시 개주시에 위치한 고구려의 산성이다.",
      },
    ],
  },
  {
    id: "profile-kr-ca71452cedc0",
    subject: "korea",
    placeIds: ["kr-ca71452cedc0"],
    title: "고구려의 성곽",
    period: "삼국 시대",
    startYear: -57,
    endYear: 668,
    eraIds: ["k-three-kingdoms"],
    summary: "중국 요령성 봉성진에 있었던 삼국시대 고구려의 성곽. 산성.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 봉황성",
        url: "https://encykorea.aks.ac.kr/Article/E0073774",
      },
    ],
    related: [
      {
        placeId: "kr-0ee1f40ad364",
        reason: "중국 요령성 봉성진에 있었던 삼국시대 고구려의 성곽. 산성.",
      },
    ],
  },
  {
    id: "profile-kr-031a5915351d",
    subject: "korea",
    placeIds: ["kr-031a5915351d"],
    title: "고구려의 무덤",
    period: "삼국 시대",
    startYear: -57,
    endYear: 668,
    eraIds: ["k-three-kingdoms"],
    summary:
      "각저총은 중화인민공화국 길림성 지안시 여산에 있는 고구려의 고분이다.",
    sources: [
      {
        title: "위키백과 기여자 · 각저총 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41253637",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-0ee1f40ad364",
        reason:
          "각저총은 중화인민공화국 길림성 지안시 여산에 있는 고구려의 고분이다.",
      },
    ],
  },
  {
    id: "profile-kr-1ae018ce2133",
    subject: "korea",
    placeIds: ["kr-1ae018ce2133"],
    title: "고구려의 도성 유적",
    period: "삼국 시대",
    startYear: -57,
    endYear: 668,
    eraIds: ["k-three-kingdoms"],
    summary: "평양직할시 대성구역에 있는 삼국시대 고구려의 도성 유적.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 안학궁",
        url: "https://encykorea.aks.ac.kr/Article/E0035088",
      },
    ],
    related: [
      {
        placeId: "kr-0ee1f40ad364",
        reason: "평양직할시 대성구역에 있는 삼국시대 고구려의 도성 유적.",
      },
    ],
  },
  {
    id: "profile-kr-6e8e468357ba",
    subject: "korea",
    placeIds: ["kr-6e8e468357ba"],
    title: "백제의 사찰 터",
    period: "삼국 시대",
    startYear: -57,
    endYear: 668,
    eraIds: ["k-three-kingdoms"],
    summary:
      "부여 정림사지는 대한민국 충청남도 부여군 부여읍 동남리에 있는 백제의 사찰 터이다.",
    sources: [
      {
        title: "위키백과 기여자 · 부여 정림사지 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41864952",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-91751bb0167f",
        reason:
          "부여 정림사지는 대한민국 충청남도 부여군 부여읍 동남리에 있는 백제의 사찰 터이다.",
      },
    ],
  },
  {
    id: "profile-kr-296dbe381817",
    subject: "korea",
    placeIds: ["kr-296dbe381817"],
    title: "백제의 석탑",
    period: "삼국 시대",
    startYear: -57,
    endYear: 668,
    eraIds: ["k-three-kingdoms"],
    summary:
      "부여 정림사지 오층석탑은 백제시대의 대표적 석탑으로서 대한민국 충청남도 부여군 부여읍 동남리에 소재하고 있다.",
    sources: [
      {
        title: "위키백과 기여자 · 부여 정림사지 오층석탑 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41864603",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-91751bb0167f",
        reason:
          "부여 정림사지 오층석탑은 백제시대의 대표적 석탑으로서 대한민국 충청남도 부여군 부여읍 동남리에 소재하고 있다.",
      },
    ],
  },
  {
    id: "profile-kr-9f415fa7f5d8",
    subject: "korea",
    placeIds: ["kr-9f415fa7f5d8"],
    title: "발해 때 설치된 지방 행정구역",
    period: "발해 시대",
    startYear: 698,
    endYear: 926,
    eraIds: ["k-balhae", "k-north-south"],
    summary:
      "솔빈부는 발해시기 지금의 러시아 연해주 우수리스크에 설치되어 금나라때까지 존재한 옛 행정구역이다.",
    sources: [
      {
        title: "위키백과 기여자 · 솔빈부 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41949316",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-6c478f7d3a3c",
        reason:
          "솔빈부는 발해시기 지금의 러시아 연해주 우수리스크에 설치되어 금나라때까지 존재한 옛 행정구역이다.",
      },
    ],
  },
  {
    id: "profile-kr-9194e3e5d89a",
    subject: "korea",
    placeIds: ["kr-9194e3e5d89a"],
    title: "발해의 지방 행정구역",
    period: "발해 시대",
    startYear: 698,
    endYear: 926,
    eraIds: ["k-balhae", "k-north-south"],
    summary: "발해시대의 지방행정구역.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 안원부",
        url: "https://encykorea.aks.ac.kr/Article/E0034923",
      },
    ],
    related: [
      {
        placeId: "kr-6c478f7d3a3c",
        reason: "발해시대의 지방행정구역.",
      },
    ],
  },
  {
    id: "profile-kr-d6ab4935b137",
    subject: "korea",
    placeIds: ["kr-d6ab4935b137"],
    title: "발해의 지방 행정구역",
    period: "발해 시대",
    startYear: 698,
    endYear: 926,
    eraIds: ["k-balhae", "k-north-south"],
    summary: "발해의 지방행정구역.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 정리부",
        url: "https://encykorea.aks.ac.kr/Article/E0050152",
      },
    ],
    related: [
      {
        placeId: "kr-6c478f7d3a3c",
        reason: "발해의 지방행정구역.",
      },
    ],
  },
  {
    id: "profile-kr-137d88ba4195",
    subject: "korea",
    placeIds: ["kr-137d88ba4195"],
    title: "발해의 지방 행정구역",
    period: "발해 시대",
    startYear: 698,
    endYear: 926,
    eraIds: ["k-balhae", "k-north-south"],
    summary: "남북국시대 발해의 지방행정구역.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 안변부",
        url: "https://encykorea.aks.ac.kr/Article/E0034745",
      },
    ],
    related: [
      {
        placeId: "kr-6c478f7d3a3c",
        reason: "남북국시대 발해의 지방행정구역.",
      },
    ],
  },
  {
    id: "profile-kr-28ceb416f0a2",
    subject: "korea",
    placeIds: ["kr-28ceb416f0a2"],
    title: "발해의 지방 행정구역",
    period: "발해 시대",
    startYear: 698,
    endYear: 926,
    eraIds: ["k-balhae", "k-north-south"],
    summary: "발해시대의 지방행정구역.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 회원부",
        url: "https://encykorea.aks.ac.kr/Article/E0065552",
      },
    ],
    related: [
      {
        placeId: "kr-6c478f7d3a3c",
        reason: "발해시대의 지방행정구역.",
      },
    ],
  },
  {
    id: "profile-kr-7414cd295707",
    subject: "korea",
    placeIds: ["kr-7414cd295707"],
    title: "발해의 지방 행정구역",
    period: "발해 시대",
    startYear: 698,
    endYear: 926,
    eraIds: ["k-balhae", "k-north-south"],
    summary: "발해시대의 지방행정구역.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 철리부",
        url: "https://encykorea.aks.ac.kr/Article/E0056123",
      },
    ],
    related: [
      {
        placeId: "kr-6c478f7d3a3c",
        reason: "발해시대의 지방행정구역.",
      },
    ],
  },
  {
    id: "profile-kr-561ae194730d",
    subject: "korea",
    placeIds: ["kr-561ae194730d"],
    title: "발해 때 설치된 부",
    period: "발해 시대",
    startYear: 698,
    endYear: 926,
    eraIds: ["k-balhae", "k-north-south"],
    summary: "막힐부는 발해 시기 설치된 부이다.",
    sources: [
      {
        title: "위키백과 기여자 · 막힐부 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=39484082",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-6c478f7d3a3c",
        reason: "막힐부는 발해 시기 설치된 부이다.",
      },
    ],
  },
  {
    id: "profile-kr-20ff8a86fa95",
    subject: "korea",
    placeIds: ["kr-20ff8a86fa95"],
    title: "발해 때 설치된 부",
    period: "발해 시대",
    startYear: 698,
    endYear: 926,
    eraIds: ["k-balhae", "k-north-south"],
    summary: "장령부는 발해 시기 설치된 부이다.",
    sources: [
      {
        title: "위키백과 기여자 · 장령부 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=39484129",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-6c478f7d3a3c",
        reason: "장령부는 발해 시기 설치된 부이다.",
      },
    ],
  },
  {
    id: "profile-kr-28d4affcbefb",
    subject: "korea",
    placeIds: ["kr-28d4affcbefb"],
    title: "발해의 지방 행정구역",
    period: "발해 시대",
    startYear: 698,
    endYear: 926,
    eraIds: ["k-balhae", "k-north-south"],
    summary: "발해시대의 지방행정구역.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 속주",
        url: "https://encykorea.aks.ac.kr/Article/E0030447",
      },
    ],
    related: [
      {
        placeId: "kr-6c478f7d3a3c",
        reason: "발해시대의 지방행정구역.",
      },
    ],
  },
  {
    id: "profile-kr-0a314eeac193",
    subject: "korea",
    placeIds: ["kr-0a314eeac193"],
    title: "당과 오가는 발해의 교역 도시",
    period: "발해 시대",
    startYear: 698,
    endYear: 926,
    eraIds: ["k-balhae", "k-north-south"],
    summary:
      "압록부라고도 부르는 발해의 주요 도시로, 당나라와 오가는 교역로에서 중요한 곳이었다.",
    sources: [
      {
        title: "위키백과 기여자 · 서경 압록부 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41354814",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-6c478f7d3a3c",
        reason:
          "압록부라고도 부르는 발해의 주요 도시로, 당나라와 오가는 교역로에서 중요한 곳이었다.",
      },
    ],
  },
  {
    id: "profile-kr-4af9ed564652",
    subject: "korea",
    placeIds: ["kr-4af9ed564652"],
    title: "당과 발해를 잇는 교역로",
    period: "발해 시대",
    startYear: 698,
    endYear: 926,
    eraIds: ["k-balhae", "k-north-south"],
    summary:
      "영주도는 조공도와 함께 당나라와 발해 간 교역로로 사용된 길로, 상경에서 장령부를 거쳐 당의 영주도독부에 이르는 길이다.",
    sources: [
      {
        title: "위키백과 기여자 · 영주도 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=39766024",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-6c478f7d3a3c",
        reason:
          "영주도는 조공도와 함께 당나라와 발해 간 교역로로 사용된 길로, 상경에서 장령부를 거쳐 당의 영주도독부에 이르는 길이다.",
      },
    ],
  },
  {
    id: "profile-kr-ea97d26f47a5",
    subject: "korea",
    placeIds: ["kr-ea97d26f47a5"],
    title: "당과 발해를 잇는 바닷길",
    period: "발해 시대",
    startYear: 698,
    endYear: 926,
    eraIds: ["k-balhae", "k-north-south"],
    summary:
      "조공도는 영주도와 함께 당나라와 발해 간 교역로로 사용된 길로, 해로로 서경압록부를 지나 압록강을 따라 황해를 통해 등주에 도착하는 길이다.",
    sources: [
      {
        title: "위키백과 기여자 · 조공도 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41110587",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-6c478f7d3a3c",
        reason:
          "조공도는 영주도와 함께 당나라와 발해 간 교역로로 사용된 길로, 해로로 서경압록부를 지나 압록강을 따라 황해를 통해 등주에 도착하는 길이다.",
      },
    ],
  },
  {
    id: "profile-kr-e7f613c01b93",
    subject: "korea",
    placeIds: ["kr-e7f613c01b93"],
    title: "당이 신라인을 위해 설치한 숙박소",
    period: "통일 신라 시대",
    startYear: 676,
    endYear: 935,
    eraIds: ["k-unified-silla", "k-north-south"],
    summary:
      "남북국시대, 당나라가 신라인을 위해서 산둥반도의 등주도독부(登州都督府)에 설치한 숙박소.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 신라관",
        url: "https://encykorea.aks.ac.kr/Article/E0032807",
      },
    ],
    related: [
      {
        placeId: "kr-f2e0675144d2",
        reason:
          "남북국시대, 당나라가 신라인을 위해서 산둥반도의 등주도독부(登州都督府)에 설치한 숙박소.",
      },
    ],
  },
  {
    id: "profile-kr-667444e22c99",
    subject: "korea",
    placeIds: ["kr-667444e22c99"],
    title: "김유신의 무덤으로 전해지는 고분",
    period: "통일 신라 시대",
    startYear: 676,
    endYear: 935,
    eraIds: ["k-unified-silla", "k-north-south"],
    summary:
      "김유신묘는 현재 대한민국 경상북도 경주시 충효동에 있는 옥녀봉 동쪽 능선 한가운데에 위치한 남북국 시대 신라의 고분으로, 신라의 장군이자 재상이었던 김유신의 무덤으로 전하고 있다.",
    sources: [
      {
        title: "위키백과 기여자 · 경주 김유신묘 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=42236967",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-e9c99a172d2b",
        reason:
          "김유신묘는 현재 대한민국 경상북도 경주시 충효동에 있는 옥녀봉 동쪽 능선 한가운데에 위치한 남북국 시대 신라의 고분으로, 신라의 장군이자 재상이었던 김유신의 무덤으로 전하고 있다.",
      },
    ],
  },
  {
    id: "profile-kr-add6d536e082",
    subject: "korea",
    placeIds: ["kr-add6d536e082"],
    title: "통일 신라의 승려가 세운 절",
    period: "통일 신라 시대",
    startYear: 676,
    endYear: 935,
    eraIds: ["k-unified-silla", "k-north-south"],
    summary:
      "강원특별자치도 평창군 진부면 오대산에 있는, 통일신라 승려 보천과 효명이 창건한 절.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 상원사",
        url: "https://encykorea.aks.ac.kr/Article/E0027234",
      },
    ],
    related: [
      {
        placeId: "kr-e9c99a172d2b",
        reason:
          "강원특별자치도 평창군 진부면 오대산에 있는, 통일신라 승려 보천과 효명이 창건한 절.",
      },
    ],
  },
  {
    id: "profile-kr-45aa0d4694b6",
    subject: "korea",
    placeIds: ["kr-45aa0d4694b6"],
    title: "통일 신라의 삼층석탑",
    period: "통일 신라 시대",
    startYear: 676,
    endYear: 935,
    eraIds: ["k-unified-silla", "k-north-south"],
    summary:
      "경주 불국사 삼층석탑은 대한민국 경상북도 경주시 불국사에 있는, 남북국 시대 신라의 삼층석탑이다.",
    sources: [
      {
        title: "위키백과 기여자 · 경주 불국사 삼층석탑 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41864566",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-e9c99a172d2b",
        reason:
          "경주 불국사 삼층석탑은 대한민국 경상북도 경주시 불국사에 있는, 남북국 시대 신라의 삼층석탑이다.",
      },
    ],
  },
  {
    id: "profile-kr-6f68810a2fb8",
    subject: "korea",
    placeIds: ["kr-6f68810a2fb8"],
    title: "통일 신라의 탑",
    period: "통일 신라 시대",
    startYear: 676,
    endYear: 935,
    eraIds: ["k-unified-silla", "k-north-south"],
    summary:
      "합천 해인사 길상탑은 경상남도 합천군 가야면, 해인사에 있는 통일신라의 탑이다.",
    sources: [
      {
        title: "위키백과 기여자 · 합천 해인사 길상탑 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41865154",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-e9c99a172d2b",
        reason:
          "합천 해인사 길상탑은 경상남도 합천군 가야면, 해인사에 있는 통일신라의 탑이다.",
      },
    ],
  },
  {
    id: "profile-kr-ab0228174178",
    subject: "korea",
    placeIds: ["kr-ab0228174178"],
    title: "풍주에서 해주로 옮긴 고려의 도호부",
    period: "고려 시대",
    startYear: 918,
    endYear: 1392,
    eraIds: ["k-goryeo"],
    summary:
      "고려가 지방을 다스리기 위해 둔 도호부로, 풍주에 설치된 뒤 해주로 옮겨졌다.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 안서도호부",
        url: "https://encykorea.aks.ac.kr/Article/E0034791",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason:
          "고려가 지방을 다스리기 위해 둔 도호부로, 풍주에 설치된 뒤 해주로 옮겨졌다.",
      },
    ],
  },
  {
    id: "profile-kr-52c80072ba18",
    subject: "korea",
    placeIds: ["kr-52c80072ba18"],
    title: "여러 지역에 설치된 고려의 도호부",
    period: "고려 시대",
    startYear: 918,
    endYear: 1392,
    eraIds: ["k-goryeo"],
    summary:
      "고려의 지방 통치 기구로, 전주·고부·영암·수주 등 시대에 따라 설치 지역이 달라졌다.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 안남도호부",
        url: "https://encykorea.aks.ac.kr/Article/E0034565",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason:
          "고려의 지방 통치 기구로, 전주·고부·영암·수주 등 시대에 따라 설치 지역이 달라졌다.",
      },
    ],
  },
  {
    id: "profile-kr-8181ea3fa9aa",
    subject: "korea",
    placeIds: ["kr-8181ea3fa9aa"],
    title: "영서 지방을 관할한 고려의 행정구역",
    period: "고려 시대",
    startYear: 918,
    endYear: 1392,
    eraIds: ["k-goryeo"],
    summary:
      "교주도는 고려의 행정구역으로, 지금의 강원도 영서 지방을 관할하였다.",
    sources: [
      {
        title: "위키백과 기여자 · 교주도 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41912539",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason:
          "교주도는 고려의 행정구역으로, 지금의 강원도 영서 지방을 관할하였다.",
      },
    ],
  },
  {
    id: "profile-kr-d469e57518ea",
    subject: "korea",
    placeIds: ["kr-d469e57518ea"],
    title: "북계와 함께 양계를 이룬 행정구역",
    period: "고려 시대",
    startYear: 918,
    endYear: 1392,
    eraIds: ["k-goryeo"],
    summary: "고려시대 북계와 함께 양계(兩界)를 구성하던 지방행정구역.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 동계",
        url: "https://encykorea.aks.ac.kr/Article/E0016205",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason: "고려시대 북계와 함께 양계(兩界)를 구성하던 지방행정구역.",
      },
    ],
  },
  {
    id: "profile-kr-557f8b86a43d",
    subject: "korea",
    placeIds: ["kr-557f8b86a43d"],
    title: "고려 성종 때 설치한 강동육주의 성보",
    period: "고려 시대",
    startYear: 918,
    endYear: 1392,
    eraIds: ["k-goryeo"],
    summary: "고려 전기, 성종 때 설치한 강동육주(江東六州)에 속한 성보(城堡).",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 흥화진",
        url: "https://encykorea.aks.ac.kr/Article/E0066073",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason:
          "고려 전기, 성종 때 설치한 강동육주(江東六州)에 속한 성보(城堡).",
      },
    ],
  },
  {
    id: "profile-kr-b33dfd1da50e",
    subject: "korea",
    placeIds: ["kr-b33dfd1da50e"],
    title: "고려 시대의 성곽",
    period: "고려 시대",
    startYear: 918,
    endYear: 1392,
    eraIds: ["k-goryeo"],
    summary:
      "강화산성은 인천광역시 강화군 강화읍 국화리에 있는 고려시대의 성곽이다.",
    sources: [
      {
        title: "위키백과 기여자 · 강화산성 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41863655",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason:
          "강화산성은 인천광역시 강화군 강화읍 국화리에 있는 고려시대의 성곽이다.",
      },
    ],
  },
  {
    id: "profile-kr-07aca2bac9b2",
    subject: "korea",
    placeIds: ["kr-07aca2bac9b2"],
    title: "원이 고려 서경에 둔 통치기관",
    period: "고려 시대",
    startYear: 918,
    endYear: 1392,
    eraIds: ["k-goryeo"],
    summary: "동녕부는 원나라가 고려 서경을 편입한 후 설치한 통치기관이다.",
    sources: [
      {
        title: "위키백과 기여자 · 동녕부 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=42228186",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-21ba070b23b6",
        reason: "동녕부는 원나라가 고려 서경을 편입한 후 설치한 통치기관이다.",
      },
    ],
  },
  {
    id: "profile-kr-d27a7a603d08",
    subject: "korea",
    placeIds: ["kr-d27a7a603d08"],
    title: "충선왕이 대도에 세운 독서당",
    period: "고려 시대",
    startYear: 918,
    endYear: 1392,
    eraIds: ["k-goryeo"],
    summary: "만권당은 고려 충선왕이 원나라의 수도인 대도에 지은 독서당이다.",
    sources: [
      {
        title: "위키백과 기여자 · 만권당 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=42362882",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason:
          "만권당은 고려 충선왕이 원나라의 수도인 대도에 지은 독서당이다.",
      },
    ],
  },
  {
    id: "profile-kr-0903aae5fa63",
    subject: "korea",
    placeIds: ["kr-0903aae5fa63"],
    title: "고려 성종 때 쌓은 산성",
    period: "고려 시대",
    startYear: 918,
    endYear: 1392,
    eraIds: ["k-goryeo"],
    summary:
      "북한 함경남도 영흥군 개마고원지대에 있는 고려시대 제6대 성종 당시 축조한 성곽. 산성.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 철옹산성",
        url: "https://encykorea.aks.ac.kr/Article/E0056146",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason:
          "북한 함경남도 영흥군 개마고원지대에 있는 고려시대 제6대 성종 당시 축조한 성곽. 산성.",
      },
    ],
  },
  {
    id: "profile-kr-6a142297546f",
    subject: "korea",
    placeIds: ["kr-6a142297546f"],
    title: "고려 후기에 고쳐 쌓은 성곽",
    period: "고려 시대",
    startYear: 918,
    endYear: 1392,
    eraIds: ["k-goryeo"],
    summary: "경상남도 진주시에 있는 고려후기에 개축된 석축 성곽.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 진주성",
        url: "https://encykorea.aks.ac.kr/Article/E0054909",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason: "경상남도 진주시에 있는 고려후기에 개축된 석축 성곽.",
      },
    ],
  },
  {
    id: "profile-kr-de482f669e56",
    subject: "korea",
    placeIds: ["kr-de482f669e56"],
    title: "관료를 길러 낸 고려의 교육기관",
    period: "고려 시대",
    startYear: 918,
    endYear: 1392,
    eraIds: ["k-goryeo"],
    summary:
      "고려시대, 성종이 관료로 선발할 인재를 교육하기 위하여 개경에 설치한 최고 교육기관.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 국자감",
        url: "https://encykorea.aks.ac.kr/Article/E0006422",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason:
          "고려시대, 성종이 관료로 선발할 인재를 교육하기 위하여 개경에 설치한 최고 교육기관.",
      },
    ],
  },
  {
    id: "profile-kr-7fb1e90e9e47",
    subject: "korea",
    placeIds: ["kr-7fb1e90e9e47"],
    title: "묘청의 건의로 대화궁을 세운 곳",
    period: "고려 시대",
    startYear: 918,
    endYear: 1392,
    eraIds: ["k-goryeo"],
    summary:
      "고려 서경의 장소로, 묘청의 건의에 따라 인종이 대화궁을 지었던 곳이다.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 인종",
        url: "https://encykorea.aks.ac.kr/Article/E0047033",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason:
          "고려 서경의 장소로, 묘청의 건의에 따라 인종이 대화궁을 지었던 곳이다.",
      },
    ],
  },
  {
    id: "profile-kr-d4c3c667b774",
    subject: "korea",
    placeIds: ["kr-d4c3c667b774"],
    title: "고려의 팔각구층석탑",
    period: "고려 시대",
    startYear: 918,
    endYear: 1392,
    eraIds: ["k-goryeo"],
    summary:
      "평창 월정사에 있는 고려시대 석탑으로, 팔각형의 몸체 위에 아홉 층을 올렸다.",
    sources: [
      {
        title: "위키백과 기여자 · 평창 월정사 팔각구층석탑 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41864706",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason:
          "평창 월정사에 있는 고려시대 석탑으로, 팔각형의 몸체 위에 아홉 층을 올렸다.",
      },
    ],
  },
  {
    id: "profile-kr-f86f6fabbb8e",
    subject: "korea",
    placeIds: ["kr-f86f6fabbb8e"],
    title: "고려 시대의 사찰 건축",
    period: "고려 시대",
    startYear: 918,
    endYear: 1392,
    eraIds: ["k-goryeo"],
    summary:
      "안동 봉정사 극락전은 경상북도 안동시 서후면 봉정사에 있는 고려시대의 건축물로 대한민국의 국보 제15호이다.",
    sources: [
      {
        title: "위키백과 기여자 · 안동 봉정사 극락전 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41577579",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason:
          "안동 봉정사 극락전은 경상북도 안동시 서후면 봉정사에 있는 고려시대의 건축물로 대한민국의 국보 제15호이다.",
      },
    ],
  },
  {
    id: "profile-kr-14d26b24bf6f",
    subject: "korea",
    placeIds: ["kr-14d26b24bf6f"],
    title: "대장경판을 보관했던 고려의 절",
    period: "고려 시대",
    startYear: 918,
    endYear: 1392,
    eraIds: ["k-goryeo"],
    summary: "강화도에 있었던 고려의 사찰로, 대장경판을 보관했던 곳이다.",
    sources: [
      {
        title: "한국학중앙연구원 조선왕조실록사전 · 선원사",
        url: "https://dh.aks.ac.kr/sillokwiki/index.php/선원사(禪源寺)",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason: "강화도에 있었던 고려의 사찰로, 대장경판을 보관했던 곳이다.",
      },
    ],
  },
  {
    id: "profile-kr-dcc9410d29b7",
    subject: "korea",
    placeIds: ["kr-dcc9410d29b7"],
    title: "원이 탐라에 둔 총관부",
    period: "고려 시대",
    startYear: 918,
    endYear: 1392,
    eraIds: ["k-goryeo"],
    summary: "탐라총관부는 고려 말기에 원나라가 탐라에 설치한 총관부이다.",
    sources: [
      {
        title: "위키백과 기여자 · 탐라총관부 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41098560",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-21ba070b23b6",
        reason: "탐라총관부는 고려 말기에 원나라가 탐라에 설치한 총관부이다.",
      },
    ],
  },
  {
    id: "profile-kr-cd6b34c09074",
    subject: "korea",
    placeIds: ["kr-cd6b34c09074"],
    title: "원이 고려에 설치한 행중서성",
    period: "고려 시대",
    startYear: 918,
    endYear: 1392,
    eraIds: ["k-goryeo"],
    summary:
      "정동등처행중서성은 원나라가 한반도의 고려를 대상으로 설치한 특수 행중서성이다.",
    sources: [
      {
        title: "위키백과 기여자 · 정동등처행중서성 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41084378",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-21ba070b23b6",
        reason:
          "정동등처행중서성은 원나라가 한반도의 고려를 대상으로 설치한 특수 행중서성이다.",
      },
    ],
  },
  {
    id: "profile-kr-3354b4a9880a",
    subject: "korea",
    placeIds: ["kr-3354b4a9880a"],
    title: "영산강변에 설치한 조창",
    period: "조선 전기",
    startYear: 1392,
    endYear: 1599,
    eraIds: ["k-joseon-early"],
    summary:
      "조선 초기 현 전남광주통합특별시 나주시의 영산강변에 설치되었던 조창(漕倉).",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 영산창",
        url: "https://encykorea.aks.ac.kr/Article/E0037439",
      },
    ],
    related: [
      {
        placeId: "kr-049670fa94f9",
        reason:
          "조선 초기 현 전남광주통합특별시 나주시의 영산강변에 설치되었던 조창(漕倉).",
      },
    ],
  },
  {
    id: "profile-kr-151eff6097f0",
    subject: "korea",
    placeIds: ["kr-151eff6097f0"],
    title: "금강 하류에 설치한 조창",
    period: "조선 전기",
    startYear: 1392,
    endYear: 1599,
    eraIds: ["k-joseon-early"],
    summary:
      "조선 전기에 금강 하류인 현 전북특별자치도 익산시 지역에 설치되었던 조창(漕倉).",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 덕성창",
        url: "https://encykorea.aks.ac.kr/Article/E0079687",
      },
    ],
    related: [
      {
        placeId: "kr-049670fa94f9",
        reason:
          "조선 전기에 금강 하류인 현 전북특별자치도 익산시 지역에 설치되었던 조창(漕倉).",
      },
    ],
  },
  {
    id: "profile-kr-f5c8b61aaadc",
    subject: "korea",
    placeIds: ["kr-f5c8b61aaadc"],
    title: "조선 후기에 세운 불전",
    period: "조선 후기",
    startYear: 1600,
    endYear: 1876,
    eraIds: ["k-joseon-late"],
    summary:
      "전북특별자치도 김제시 금산면 금산사에 있는 조선후기에 창건된 사찰건물. 불전.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 김제 금산사 미륵전",
        url: "https://encykorea.aks.ac.kr/Article/E0007804",
      },
    ],
    related: [
      {
        placeId: "kr-049670fa94f9",
        reason:
          "전북특별자치도 김제시 금산면 금산사에 있는 조선후기에 창건된 사찰건물. 불전.",
      },
    ],
  },
  {
    id: "profile-kr-09a5e4baa822",
    subject: "korea",
    placeIds: ["kr-09a5e4baa822"],
    title: "조선 후기에 다시 지은 불전",
    period: "조선 후기",
    startYear: 1600,
    endYear: 1876,
    eraIds: ["k-joseon-late"],
    summary:
      "전라남도 구례군 마산면 화엄사에 있는 조선후기에 중건된 사찰건물. 불전.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 구례 화엄사 각황전",
        url: "https://encykorea.aks.ac.kr/Article/E0064786",
      },
    ],
    related: [
      {
        placeId: "kr-049670fa94f9",
        reason:
          "전라남도 구례군 마산면 화엄사에 있는 조선후기에 중건된 사찰건물. 불전.",
      },
    ],
  },
  {
    id: "profile-kr-ed8ad25e7791",
    subject: "korea",
    placeIds: ["kr-ed8ad25e7791"],
    title: "정조가 수원에 머물던 행궁",
    period: "조선 후기",
    startYear: 1600,
    endYear: 1876,
    eraIds: ["k-joseon-late"],
    summary:
      "정조가 수원에 머물 때 사용한 임시 궁궐로, 평소에는 수원 유수의 집무 공간이었다.",
    sources: [
      {
        title: "위키백과 기여자 · 수원 화성행궁 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41870191",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
  },
  {
    id: "profile-kr-92fc65b50b2f",
    subject: "korea",
    placeIds: ["kr-92fc65b50b2f"],
    title: "구석기부터 청동기까지의 동굴 유적",
    period: "선사 시대",
    startYear: -100000,
    eraIds: ["k-prehistory"],
    summary:
      "단양에 있는 선사시대 동굴 유적으로, 구석기부터 청동기시대까지의 생활 흔적이 발견되었다.",
    sources: [
      {
        title: "위키백과 기여자 · 단양 금굴 유적 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=39415074",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
  },
  {
    id: "profile-kr-7f56039faff8",
    subject: "korea",
    placeIds: ["kr-7f56039faff8"],
    title: "선사인의 생활 흔적이 남은 유적",
    period: "선사 시대",
    startYear: -100000,
    eraIds: ["k-prehistory"],
    summary:
      "충북 단양 애곡리에 있는 선사시대 유적으로, 옛사람들의 생활 흔적이 남아 있다.",
    sources: [
      {
        title: "위키백과 기여자 · 단양 수양개 유적 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41865515",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
  },
  {
    id: "profile-kr-f4e7192113d0",
    subject: "korea",
    placeIds: ["kr-f4e7192113d0"],
    title: "영국의 선사 시대 거석 유적",
    period: "선사 시대",
    startYear: -100000,
    eraIds: ["k-prehistory"],
    summary:
      "스톤헨지는 영국 남부 윌트셔 주 솔즈베리 평원과 에임즈버리에 있는 선사 시대의 거석기념물이자 선사 시대의 환상 열석 유적이다.",
    sources: [
      {
        title: "위키백과 기여자 · 스톤헨지 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41860301",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
  },
  {
    id: "profile-world-d0eefaa3ad53",
    subject: "world",
    placeIds: ["world-d0eefaa3ad53"],
    title: "두 발 걷기의 증거가 남은 발자국 유적",
    period: "선사 시대",
    startYear: -4000000,
    eraIds: ["w-prehistory"],
    summary:
      "탄자니아의 선사 유적으로, 화산재에 남은 초기 인류의 발자국이 두 발 걷기의 중요한 증거가 된 곳이다.",
    sources: [
      {
        title: "영문 위키백과 기여자 · Laetoli (본문 번역·요약)",
        url: "https://en.wikipedia.org/w/index.php?oldid=1364840389",
        license: "CC BY-SA 4.0 · 변경: 한국어 번역·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
  },
  {
    id: "profile-world-fe16399ca5cc",
    subject: "world",
    placeIds: ["world-fe16399ca5cc"],
    title: "로마 제국의 속주",
    period: "고대",
    startYear: -3500,
    endYear: 499,
    eraIds: ["w-ancient"],
    summary:
      "브리타니아는 고대 로마 시대에 오늘날 영국의 그레이트브리튼섬을 이르던 말이자, 로마 제국의 브리타니아 정복 이후 로마 제국의 속주의 이름이다.",
    sources: [
      {
        title: "위키백과 기여자 · 브리타니아 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41081957",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "world-1a1f1b780879",
        reason:
          "브리타니아는 고대 로마 시대에 오늘날 영국의 그레이트브리튼섬을 이르던 말이자, 로마 제국의 브리타니아 정복 이후 로마 제국의 속주의 이름이다.",
      },
    ],
  },
  {
    id: "profile-world-bed99b42ef92",
    subject: "world",
    placeIds: ["world-bed99b42ef92"],
    title: "고대 아시리아의 수도",
    period: "고대",
    startYear: -3500,
    endYear: 499,
    eraIds: ["w-ancient"],
    summary:
      "아수르는 고대 아시리아의 수도 가운데 하나였던 도시로, 구아시리아 제국·중아시리아 제국 당시 서울 노릇을 했으며 신아시리아 제국 대에 이르러서도 잠시 동안 수도였다.",
    sources: [
      {
        title: "위키백과 기여자 · 아수르 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=39070197",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "world-e7a04056a204",
        reason:
          "아수르는 고대 아시리아의 수도 가운데 하나였던 도시로, 구아시리아 제국·중아시리아 제국 당시 서울 노릇을 했으며 신아시리아 제국 대에 이르러서도 잠시 동안 수도였다.",
      },
    ],
  },
  {
    id: "profile-world-2edf429694b8",
    subject: "world",
    placeIds: ["world-2edf429694b8"],
    title: "고대 아시리아의 수도 유적",
    period: "고대",
    startYear: -3500,
    endYear: 499,
    eraIds: ["w-ancient"],
    summary:
      "티그리스강 서쪽에 있던 고대 아시리아의 수도로, 오늘날 이라크에 도시 유적이 남아 있다.",
    sources: [
      {
        title: "위키백과 기여자 · 아수르 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=39070197",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "world-e7a04056a204",
        reason:
          "티그리스강 서쪽에 있던 고대 아시리아의 수도로, 오늘날 이라크에 도시 유적이 남아 있다.",
      },
    ],
  },
  {
    id: "profile-kr-a6a9d2c0ff15",
    subject: "korea",
    placeIds: ["kr-a6a9d2c0ff15"],
    title: "강남에 세워진 동진",
    period: "317~420년",
    startYear: 317,
    endYear: 420,
    eraIds: ["k-three-kingdoms"],
    summary:
      "동진(東晉, 317년 ~ 420년)은 중국의 왕조로, 서진이 유연의 한나라에게 멸망한 후, 사마예에 의해 강남에 세워진 진의 망명 왕조이다.",
    sources: [
      {
        title: "위키백과 기여자 · 동진 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41391343",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
  },
  {
    id: "profile-kr-e1786a782c45",
    subject: "korea",
    placeIds: ["kr-e1786a782c45"],
    title: "백제 멸망 뒤 당이 설치한 관청",
    period: "660년",
    startYear: 660,
    eraIds: ["k-three-kingdoms"],
    summary:
      "웅진도독부는 660년(의자왕 20년) 백제가 멸망한 뒤 당나라가 그 고지에 설치한 행정 관청으로, 5도독부의 하나이다.",
    sources: [
      {
        title: "위키백과 기여자 · 웅진도독부 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=42037141",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-f2e0675144d2",
        reason:
          "웅진도독부는 660년(의자왕 20년) 백제가 멸망한 뒤 당나라가 그 고지에 설치한 행정 관청으로, 5도독부의 하나이다.",
      },
    ],
  },
  {
    id: "profile-kr-74eb96d6661b",
    subject: "korea",
    placeIds: ["kr-74eb96d6661b"],
    title: "신라가 쌓고 고쳐 세운 산성",
    period: "470·486년",
    startYear: 470,
    endYear: 486,
    eraIds: ["k-three-kingdoms"],
    summary:
      "보은 삼년산성은 충청북도 보은군 보은읍에 있는 돌로 쌓은 산성으로 신라 자비왕 13년(470)에 쌓았으며, 소지왕 8년(486)에 고쳐 세웠다.",
    sources: [
      {
        title: "위키백과 기여자 · 보은 삼년산성 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41864521",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-e9c99a172d2b",
        reason:
          "보은 삼년산성은 충청북도 보은군 보은읍에 있는 돌로 쌓은 산성으로 신라 자비왕 13년(470)에 쌓았으며, 소지왕 8년(486)에 고쳐 세웠다.",
      },
    ],
  },
  {
    id: "profile-kr-484a8c58cf97",
    subject: "korea",
    placeIds: ["kr-484a8c58cf97"],
    title: "발해 건국으로 이어진 천문령 전투",
    period: "698년",
    startYear: 698,
    eraIds: ["k-balhae", "k-north-south"],
    summary:
      "698년 대조영의 세력이 당나라 군대와 싸운 곳으로, 발해 건국으로 이어지는 전투의 무대였다.",
    sources: [
      {
        title: "위키백과 기여자 · 천문령 전투 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=42004670",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-6c478f7d3a3c",
        reason:
          "698년 대조영의 세력이 당나라 군대와 싸운 곳으로, 발해 건국으로 이어지는 전투의 무대였다.",
      },
    ],
  },
  {
    id: "profile-kr-3b3febd4b882",
    subject: "korea",
    placeIds: ["kr-3b3febd4b882"],
    title: "북계에서 서북면으로 이름을 바꾸다",
    period: "1102년",
    startYear: 1102,
    eraIds: ["k-goryeo"],
    summary:
      "북계는 고려의 행정구역인 5도 양계에서 동계와 함께 양계를 구성하며, 1102년(숙종 7년)에는 서북면으로 개칭하였다.",
    sources: [
      {
        title: "위키백과 기여자 · 북계 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=40857922",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason:
          "북계는 고려의 행정구역인 5도 양계에서 동계와 함께 양계를 구성하며, 1102년(숙종 7년)에는 서북면으로 개칭하였다.",
      },
    ],
  },
  {
    id: "profile-kr-a63c13ee6f60",
    subject: "korea",
    placeIds: ["kr-a63c13ee6f60"],
    title: "고려 현종 때 확립된 행정구역",
    period: "1018년",
    startYear: 1018,
    eraIds: ["k-goryeo"],
    summary:
      "양광도 또는 양광충청주도는 고려의 행정구역인 5도 양계 중 5도에 속하는 지역으로, 1018년 고려 현종 시기 확립되었다.",
    sources: [
      {
        title: "위키백과 기여자 · 양광도 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41960493",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason:
          "양광도 또는 양광충청주도는 고려의 행정구역인 5도 양계 중 5도에 속하는 지역으로, 1018년 고려 현종 시기 확립되었다.",
      },
    ],
  },
  {
    id: "profile-kr-32465a244847",
    subject: "korea",
    placeIds: ["kr-32465a244847"],
    title: "고려 광종 때 북계에 설치한 진",
    period: "973년",
    startYear: 973,
    eraIds: ["k-goryeo"],
    summary: "고려 전기 973년(광종 24), 북계 지역에 설치한 진(鎭).",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 안융진",
        url: "https://encykorea.aks.ac.kr/Article/E0034935",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason: "고려 전기 973년(광종 24), 북계 지역에 설치한 진(鎭).",
      },
    ],
  },
  {
    id: "profile-kr-44da41317857",
    subject: "korea",
    placeIds: ["kr-44da41317857"],
    title: "화주에 설치된 원의 통치기구",
    period: "1258년",
    startYear: 1258,
    eraIds: ["k-goryeo"],
    summary:
      "쌍성총관부는 1258년(고종 45년)에 원나라가 화주에 설치한 통치기구이다.",
    sources: [
      {
        title: "위키백과 기여자 · 쌍성총관부 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=39041938",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-21ba070b23b6",
        reason:
          "쌍성총관부는 1258년(고종 45년)에 원나라가 화주에 설치한 통치기구이다.",
      },
    ],
  },
  {
    id: "profile-kr-a49feffdb9e7",
    subject: "korea",
    placeIds: ["kr-a49feffdb9e7"],
    title: "고려 광종 때 혜명이 세운 절",
    period: "968년",
    startYear: 968,
    eraIds: ["k-goryeo"],
    summary:
      "관촉사는 고려 광종 19년(968) 혜명이 창건한 사찰로 대한 불교 조계종 제6교구 본사인 마곡사의 말사이다.",
    sources: [
      {
        title: "위키백과 기여자 · 관촉사 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41896468",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason:
          "관촉사는 고려 광종 19년(968) 혜명이 창건한 사찰로 대한 불교 조계종 제6교구 본사인 마곡사의 말사이다.",
      },
    ],
  },
  {
    id: "profile-kr-253b59b92227",
    subject: "korea",
    placeIds: ["kr-253b59b92227"],
    title: "진흥왕의 황초령 순시를 기념한 비석",
    period: "568년",
    startYear: 568,
    eraIds: ["k-three-kingdoms"],
    summary:
      "신라 진흥왕이 568년 함경남도 황초령 일대를 순시한 일을 기념해 세운 비석이다.",
    sources: [
      {
        title: "위키백과 기여자 · 황초령 진흥왕 순수비 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=39179558",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-e9c99a172d2b",
        reason:
          "신라 진흥왕이 568년 함경남도 황초령 일대를 순시한 일을 기념해 세운 비석이다.",
      },
    ],
  },
  {
    id: "profile-kr-a52af3e9391a",
    subject: "korea",
    placeIds: ["kr-a52af3e9391a"],
    title: "선덕여왕 때 세운 것으로 보는 석탑",
    period: "634년 무렵",
    startYear: 634,
    eraIds: ["k-three-kingdoms"],
    summary:
      "경주 분황사에 있는 신라의 석탑으로, 선덕여왕 때인 634년에 세운 것으로 본다.",
    sources: [
      {
        title: "위키백과 기여자 · 경주 분황사 모전석탑 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=42219201",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-e9c99a172d2b",
        reason:
          "경주 분황사에 있는 신라의 석탑으로, 선덕여왕 때인 634년에 세운 것으로 본다.",
      },
    ],
  },
  {
    id: "profile-kr-a4c7cb9e3771",
    subject: "korea",
    placeIds: ["kr-a4c7cb9e3771"],
    title: "고구려의 계단식 돌무지무덤",
    period: "5세기 전반 무렵",
    startYear: 400,
    endYear: 449,
    eraIds: ["k-three-kingdoms"],
    summary:
      "중국 지린성 집안시 통구분지 우산하고분군에 있는 고구려시대 5세기 전반경에 조성된 계단식 돌방 돌무지무덤.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 장군총",
        url: "https://encykorea.aks.ac.kr/Article/E0048318",
      },
    ],
    related: [
      {
        placeId: "kr-0ee1f40ad364",
        reason:
          "중국 지린성 집안시 통구분지 우산하고분군에 있는 고구려시대 5세기 전반경에 조성된 계단식 돌방 돌무지무덤.",
      },
    ],
  },
  {
    id: "profile-kr-44b0829b8f2d",
    subject: "korea",
    placeIds: ["kr-44b0829b8f2d"],
    title: "고구려 멸망 뒤 당이 평양에 둔 군정기관",
    period: "668년",
    startYear: 668,
    eraIds: ["k-three-kingdoms"],
    summary:
      "안동도호부는 당나라가 고구려를 멸망시키고 668년, 평양에 설치한 군정 기관이다.",
    sources: [
      {
        title: "위키백과 기여자 · 안동도호부 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=42135366",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-f2e0675144d2",
        reason:
          "안동도호부는 당나라가 고구려를 멸망시키고 668년, 평양에 설치한 군정 기관이다.",
      },
    ],
  },
  {
    id: "profile-kr-d452f401e493",
    subject: "korea",
    placeIds: ["kr-d452f401e493"],
    title: "당 해안의 신라인 자치기관",
    period: "8세기 중엽 이후",
    startYear: 750,
    endYear: 935,
    eraIds: ["k-unified-silla", "k-north-south"],
    summary: "8세기 중엽 이후 신라인이 당나라 해안 곳곳에 설치한 자치기관.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 신라소",
        url: "https://encykorea.aks.ac.kr/Article/E0032835",
      },
    ],
    related: [
      {
        placeId: "kr-e9c99a172d2b",
        reason: "8세기 중엽 이후 신라인이 당나라 해안 곳곳에 설치한 자치기관.",
      },
    ],
  },
  {
    id: "profile-kr-b11ce9919656",
    subject: "korea",
    placeIds: ["kr-b11ce9919656"],
    title: "고려 말 경천사에 세운 석탑",
    period: "1348년",
    startYear: 1348,
    eraIds: ["k-goryeo"],
    summary: "고려 말인 1348년 개성 경천사에 세운 열 층의 석탑이다.",
    sources: [
      {
        title: "위키백과 기여자 · 개성 경천사지 십층석탑 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41864589",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason: "고려 말인 1348년 개성 경천사에 세운 열 층의 석탑이다.",
      },
    ],
  },
  {
    id: "profile-kr-c4e47e3d8e21",
    subject: "korea",
    placeIds: ["kr-c4e47e3d8e21"],
    title: "광해군 때 건립한 궁궐",
    period: "1617년",
    startYear: 1617,
    eraIds: ["k-joseon-late"],
    summary:
      "경희궁은 대한민국 서울특별시에 있는 조선 시대 궁궐로 광해군 9년(1617년)에 건립한 이후, 10대에 걸쳐 임금이 정사를 보았던 궁궐이다.",
    sources: [
      {
        title: "위키백과 기여자 · 경희궁 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=42524696",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-049670fa94f9",
        reason:
          "경희궁은 대한민국 서울특별시에 있는 조선 시대 궁궐로 광해군 9년(1617년)에 건립한 이후, 10대에 걸쳐 임금이 정사를 보았던 궁궐이다.",
      },
    ],
  },
  {
    id: "profile-kr-12968d0538d3",
    subject: "korea",
    placeIds: ["kr-12968d0538d3"],
    title: "고려 때 개심사에 세운 석탑",
    period: "1010년",
    startYear: 1010,
    eraIds: ["k-goryeo"],
    summary: "고려시대인 1010년에 세운 예천 개심사 터의 오층 석탑이다.",
    sources: [
      {
        title: "위키백과 기여자 · 예천 개심사지 오층석탑 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41768775",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "kr-c75537fc787b",
        reason: "고려시대인 1010년에 세운 예천 개심사 터의 오층 석탑이다.",
      },
    ],
  },
  {
    id: "profile-world-a84dd0f2f304",
    subject: "world",
    placeIds: ["world-a84dd0f2f304"],
    title: "현장이 가져온 경전과 불상을 보관한 탑",
    period: "652년",
    startYear: 652,
    eraIds: ["w-medieval"],
    summary:
      "대안탑이란 652년에 당나라의 고승 삼장법사 현장이 인도에서 귀국할 때 가지고 온 경전이나 불상 등을 보존하기 위해서 고종에게 요청하여 건립한 탑이다.",
    sources: [
      {
        title: "위키백과 기여자 · 대안탑 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=40078272",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "world-f2e0675144d2",
        reason:
          "대안탑이란 652년에 당나라의 고승 삼장법사 현장이 인도에서 귀국할 때 가지고 온 경전이나 불상 등을 보존하기 위해서 고종에게 요청하여 건립한 탑이다.",
      },
    ],
  },
  {
    id: "profile-world-47d4f1ccd9eb",
    subject: "world",
    placeIds: ["world-47d4f1ccd9eb"],
    title: "아테네군이 페르시아군을 물리친 전투",
    period: "기원전 490년",
    startYear: -490,
    eraIds: ["w-ancient"],
    summary:
      "그리스의 평원으로, 기원전 490년 아테네군이 페르시아군을 물리친 전투가 벌어졌다.",
    sources: [
      {
        title: "위키백과 기여자 · 마라톤 전투 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=39116359",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
  },
  {
    id: "profile-world-fdc76662f59a",
    subject: "world",
    placeIds: ["world-fdc76662f59a"],
    title: "칼데아인의 바빌로니아 제국",
    period: "기원전 626~539년",
    startYear: -626,
    endYear: -539,
    eraIds: ["w-ancient"],
    summary:
      "신바빌로니아 제국 또는 바빌로니아 제2제국은 기원전 626년부터 기원전 539년까지 존재한 칼데아인의 바빌로니아 제국이다.",
    sources: [
      {
        title: "위키백과 기여자 · 신바빌로니아 제국 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41736359",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
  },
  {
    id: "profile-world-fbf8723724e5",
    subject: "world",
    placeIds: ["world-fbf8723724e5"],
    title: "로마 제국의 서방 황제들이 다스린 영역",
    period: "395~476년",
    startYear: 395,
    endYear: 476,
    eraIds: ["w-ancient"],
    summary:
      "서로마 제국은 로마 제국이 동서로 분할된 395년부터 476년까지 서방 황제의 치하로 존속한 로마 제국의 연속체로, 공식 국호는 이전과 같은 로마 제국이다.",
    sources: [
      {
        title: "위키백과 기여자 · 서로마 제국 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41827111",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
    related: [
      {
        placeId: "world-1a1f1b780879",
        reason:
          "서로마 제국은 로마 제국이 동서로 분할된 395년부터 476년까지 서방 황제의 치하로 존속한 로마 제국의 연속체로, 공식 국호는 이전과 같은 로마 제국이다.",
      },
    ],
  },
  {
    id: "profile-world-05562438a3b1",
    subject: "world",
    placeIds: ["world-05562438a3b1"],
    title: "중앙아시아와 서아시아를 지배한 제국",
    period: "1040~1157년",
    startYear: 1040,
    endYear: 1157,
    eraIds: ["w-medieval"],
    summary:
      "셀주크 튀르크, 셀주크 왕조 혹은 셀주크 제국은 1040년부터 1157년까지 중앙아시아, 이란, 이라크, 시리아를 지배한 제국이다.",
    sources: [
      {
        title: "위키백과 기여자 · 셀주크 제국 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41990499",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
  },
  {
    id: "profile-world-bd11ee8b460f",
    subject: "world",
    placeIds: ["world-bd11ee8b460f"],
    title: "북이탈리아에 세워진 게르만족 왕국",
    period: "568~774년",
    startYear: 568,
    endYear: 774,
    eraIds: ["w-medieval"],
    summary:
      "랑고바르드 왕국(568년~774년)은 스칸디나비아에서 남하한 게르만계 랑고바르드족이 도나우강에 정착한 이후 6세기 말 알보이누스의 명령 아래 동로마 제국령 이탈리아를 침공하여 북이탈리아를 빼앗고 세운 왕국이다.",
    sources: [
      {
        title: "위키백과 기여자 · 롬바르드 왕국 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=42026355",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
  },
  {
    id: "profile-world-a6a9d2c0ff15",
    subject: "world",
    placeIds: ["world-a6a9d2c0ff15"],
    title: "강남에 세워진 동진",
    period: "317~420년",
    startYear: 317,
    endYear: 420,
    eraIds: ["w-ancient"],
    summary:
      "동진(東晉, 317년 ~ 420년)은 중국의 왕조로, 서진이 유연의 한나라에게 멸망한 후, 사마예에 의해 강남에 세워진 진의 망명 왕조이다.",
    sources: [
      {
        title: "위키백과 기여자 · 동진 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=41391343",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
  },
  {
    id: "profile-world-6c478f7d3a3c",
    subject: "world",
    placeIds: ["world-6c478f7d3a3c"],
    title: "대조영의 발해 건국",
    period: "698년",
    startYear: 698,
    eraIds: ["w-medieval"],
    summary: "발해, 발해국은 698년 대조영이 건국한 국가이다.",
    sources: [
      {
        title: "위키백과 기여자 · 발해 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=42659048",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
  },
  {
    id: "profile-world-f192a1edf3ff",
    subject: "world",
    placeIds: ["world-f192a1edf3ff"],
    title: "합스부르크 영지를 통합해 선포한 제국",
    period: "1804년",
    startYear: 1804,
    eraIds: ["w-modern"],
    summary:
      "오스트리아 제국은 나폴레옹이 프랑스 제1제국을 선포하자 이에 맞서 프란츠 2세가 1804년 신성 로마 제국 내의 합스부르크가 영지를 통합하면서 선포한 제국이다.",
    sources: [
      {
        title: "위키백과 기여자 · 오스트리아 제국 (본문 발췌·요약)",
        url: "https://ko.wikipedia.org/w/index.php?oldid=42284903",
        license: "CC BY-SA 4.0 · 변경: 발음 표기 생략·문장 요약",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
      },
    ],
  },
];
