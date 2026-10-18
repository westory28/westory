import type { AtlasPlace } from "../lib/historyAtlas";
import type { AtlasHistoricalStory } from "../lib/historyAtlasStories";

/** Korean-history accounts for existing foreign places whose source ledger
 * only had map captions. These are factual summaries of the linked public
 * historical references, not copied source prose or generic world entries.
 * Existing city reference coordinates are retained; no point purports to
 * locate a historic audience hall, hostage residence, or declaration venue.
 */
export const atlasKoreaForeignContextPlaceUpdates: (Partial<AtlasPlace> & {
  id: string;
})[] = [
  {
    id: "kr-ed074edaab7c",
    modernName: "중국 랴오닝성 선양",
    aliases: ["심양"],
  },
];

const geonamesSource = (id: number, name: string) => ({
  title: `GeoNames · ${name} (${id}, 현대 도시 대표 위치)`,
  url: `https://www.geonames.org/${id}/`,
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
});

export const atlasKoreaForeignContextStories: AtlasHistoricalStory[] = [
  {
    id: "korea-kyoto-envoys",
    subject: "korea",
    placeIds: ["kr-23f8483f8d47"],
    displayNames: { "kr-23f8483f8d47": "교토" },
    title: "임진왜란 전 교토로 간 통신사",
    period: "1590년",
    startYear: 1590,
    eraIds: ["k-joseon-early"],
    summary:
      "1590년 조선은 황윤길·김성일·허성을 통신사로 보내 일본의 정세를 살피게 했다. 교토를 목적지로 한 이 사절단은 도요토미 히데요시를 만났으며, 임진왜란이 일어나기 전 조선과 일본의 외교 교섭을 보여 준다.",
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 조선시대 통신사의 일본 사행록",
        url: "https://contents.history.go.kr/front/km/view.do?levelId=km_029_0040_0010_0040",
      },
      {
        title: "국사편찬위원회 우리역사넷 · 임진왜란",
        url: "https://contents.history.go.kr/front/kc/printViewPopup.do?levelId=kc_i305500",
      },
      geonamesSource(1857910, "Kyoto"),
    ],
  },
  {
    id: "korea-edo-tongsinsa",
    subject: "korea",
    placeIds: ["tokyo"],
    displayNames: { tokyo: "에도" },
    title: "에도로 간 조선 통신사",
    period: "1607~1764년",
    startYear: 1607,
    endYear: 1764,
    eraIds: ["k-joseon-late"],
    summary:
      "임진왜란 뒤 조선은 1607년 회답 겸 쇄환사를 에도로 보내 외교 관계를 회복하고 전쟁 포로를 데려오고자 했다. 이후 통신사는 도쿠가와 막부의 쇼군에게 국서를 전하고 문화를 교류했으며, 1764년 사행도 에도를 목적지로 삼았다.",
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 조선 후기 통신사와 교린 체제",
        url: "https://contents.history.go.kr/front/km/view.do?levelId=km_029_0040_0010_0010",
      },
      {
        title: "국사편찬위원회 우리역사넷 · 조선시대 통신사의 일본 사행록",
        url: "https://contents.history.go.kr/front/km/view.do?levelId=km_029_0040_0010_0040",
      },
    ],
  },
  {
    id: "korea-shenyang-sohyeon",
    subject: "korea",
    placeIds: ["kr-ed074edaab7c"],
    displayNames: { "kr-ed074edaab7c": "심양" },
    title: "병자호란 뒤 심양에 머문 소현세자",
    period: "1637~1644년",
    startYear: 1637,
    endYear: 1644,
    eraIds: ["k-joseon-late"],
    summary:
      "병자호란의 항복 조건에 따라 소현세자와 봉림대군은 1637년 청의 수도 심양으로 보내졌다. 소현세자 일행은 심양관에 머물며 조선과 청 사이의 연락과 외교 업무를 맡았고, 1644년 청이 북경으로 천도하자 거처를 옮겼다.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 심양관",
        url: "https://encykorea.aks.ac.kr/Article/E0076460",
      },
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 심양일기",
        url: "https://encykorea.aks.ac.kr/Article/E0033853",
      },
      geonamesSource(2034937, "Shenyang"),
    ],
    related: [
      {
        placeId: "namhansanseong",
        targetEntryId: "story-korea-namhansanseong-namhansanseong",
        reason:
          "남한산성의 항전이 끝난 뒤 맺은 화약에 따라 소현세자 일행이 심양으로 보내졌다.",
      },
      {
        placeId: "beijing",
        targetEntryId: "story-korea-beijing-sohyeon-beijing",
        reason: "1644년 청의 천도에 따라 소현세자는 심양에서 북경으로 옮겼다.",
      },
    ],
  },
  {
    id: "korea-beijing-sohyeon",
    subject: "korea",
    placeIds: ["beijing"],
    displayNames: { beijing: "북경" },
    title: "북경에서 서양 문물을 접한 소현세자",
    period: "1644년",
    startYear: 1644,
    eraIds: ["k-joseon-late"],
    summary:
      "1644년 심양에서 북경으로 옮긴 소현세자는 서양 선교사 아담 샬과 교류하며 천문과 역법에 관심을 기울였다. 천문·수학·천주교 관련 서적과 서양 문물을 받아들인 경험은 병자호란 이후 조선이 청을 통해 새로운 지식을 접한 사례이다.",
    sources: [
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 소현세자",
        url: "https://encykorea.aks.ac.kr/Article/E0030360",
      },
      {
        title: "한국학중앙연구원 한국민족문화대백과사전 · 심양관",
        url: "https://encykorea.aks.ac.kr/Article/E0076460",
      },
    ],
    related: [
      {
        placeId: "kr-ed074edaab7c",
        targetEntryId: "story-korea-shenyang-sohyeon-kr-ed074edaab7c",
        reason:
          "북경으로 옮기기 전 소현세자는 심양관에서 조선과 청의 외교를 담당했다.",
      },
    ],
  },
  {
    id: "korea-tokyo-february-eighth",
    subject: "korea",
    placeIds: ["tokyo"],
    displayNames: { tokyo: "도쿄" },
    title: "도쿄 유학생들의 2·8 독립선언",
    period: "1919년 2월 8일",
    startYear: 1919,
    eraIds: ["k-colonial"],
    summary:
      "1919년 2월 8일 도쿄의 조선인 유학생들은 조선청년독립단의 이름으로 독립을 선언했다. 조선기독교청년회관에 모인 학생들의 선언과 국내에 전달된 준비 소식은 3·1운동에 영향을 주었다.",
    sources: [
      {
        title: "국사편찬위원회 우리역사넷 · 2·8 독립 선언서와 해설",
        url: "https://contents.history.go.kr/front/hm/print.do?levelId=hm_123_0030",
      },
    ],
    related: [
      {
        placeId: "seoul",
        targetEntryId: "story-korea-march-first-seoul",
        reason:
          "도쿄의 2·8 독립선언과 국내로 전해진 소식은 3·1 독립선언에 영향을 주었다.",
      },
    ],
  },
];
