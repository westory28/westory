export type HistoryDictionaryFacetGroup =
  | "subject"
  | "era"
  | "region"
  | "topic";

export interface HistoryDictionaryFacet {
  id: string;
  label: string;
  group: HistoryDictionaryFacetGroup;
  parentId?: string;
  subjectId?: string;
}

export const HISTORY_DICTIONARY_FACET_GROUP_LABELS: Record<
  HistoryDictionaryFacetGroup,
  string
> = {
  subject: "분야",
  era: "관련 시대",
  region: "지역",
  topic: "주제",
};

export const HISTORY_DICTIONARY_THEME_HELP =
  "관련 시대는 뜻풀이와 확인된 역사 설명을 기준으로 묶었습니다. 장소의 성립 연대나 존속 기간 전체를 뜻하지 않습니다. 조선 8도는 지도와 같은 역사 지역 탐색 기준이며 오늘날의 행정구역과 다릅니다. 근거가 부족한 시대는 표시하지 않고 지역은 미확인으로 구분합니다.";

const facet = (
  id: string,
  label: string,
  group: HistoryDictionaryFacetGroup,
  parentId?: string,
  subjectId?: string,
): HistoryDictionaryFacet => ({
  id,
  label,
  group,
  ...(parentId ? { parentId } : {}),
  ...(subjectId ? { subjectId } : {}),
});

export const historyDictionaryFacets: HistoryDictionaryFacet[] = [
  facet("subject:korea", "한국사", "subject"),
  facet("subject:world", "세계사", "subject"),
  ...[
    ["k-prehistory", "선사 시대"],
    ["k-gojoseon", "고조선"],
    ["k-early-states", "여러 나라의 성장"],
    ["k-three-kingdoms", "삼국 시대·가야"],
    ["k-unified-silla", "통일 신라"],
    ["k-balhae", "발해"],
    ["k-north-south", "남북국 시대"],
    ["k-later-three", "후삼국 시대"],
    ["k-goryeo", "고려"],
    ["k-joseon", "조선"],
    ["k-joseon-early", "조선 전기"],
    ["k-joseon-late", "조선 후기"],
    ["k-opening", "개항기·대한 제국"],
    ["k-colonial", "일제 강점기"],
    ["k-modern", "현대"],
  ].map(([id, label]) =>
    facet(
      `era:${id}`,
      label,
      "era",
      ["k-joseon-early", "k-joseon-late"].includes(id)
        ? "era:k-joseon"
        : undefined,
      "subject:korea",
    ),
  ),
  ...[
    ["w-prehistory", "선사 시대"],
    ["w-ancient", "고대 문명과 국가"],
    ["w-medieval", "중세·지역 문화권"],
    ["w-early-modern", "근세·교류의 확대"],
    ["w-modern", "근대·혁명과 국민 국가"],
    ["w-wars", "제국주의·세계 대전"],
    ["w-contemporary", "냉전·현대"],
  ].map(([id, label]) =>
    facet(`era:${id}`, label, "era", undefined, "subject:world"),
  ),
  facet("era:common", "시대 공통", "era"),
  ...[
    ["europe", "유럽"],
    ["asia", "아시아"],
    ["africa", "아프리카"],
    ["america", "아메리카"],
    ["oceania", "오세아니아"],
    ["middle-east", "중동"],
    ["antarctica", "남극"],
    ["arctic", "북극"],
    ["greenland", "그린란드"],
    ["water", "바다·대양"],
  ].map(([id, label]) => facet(`region:${id}`, label, "region")),
  ...[
    ["europe-west", "서유럽", "europe"],
    ["europe-east", "동유럽", "europe"],
    ["europe-south", "남유럽", "europe"],
    ["europe-north", "북유럽", "europe"],
    ["asia-west", "서아시아", "asia"],
    ["asia-south", "남아시아", "asia"],
    ["asia-east", "동아시아", "asia"],
    ["asia-southeast", "동남아시아", "asia"],
    ["asia-central", "중앙아시아", "asia"],
    ["asia-north", "북아시아", "asia"],
    ["africa-north", "북아프리카", "africa"],
    ["africa-south", "남아프리카", "africa"],
    ["africa-east", "동아프리카", "africa"],
    ["africa-west", "서아프리카", "africa"],
    ["africa-central", "중앙아프리카", "africa"],
    ["america-north", "북아메리카", "america"],
    ["america-south", "남아메리카", "america"],
    ["america-central", "중앙아메리카", "america"],
    ["america-caribbean", "카리브 지역", "america"],
    ["oceania-australia", "오스트레일리아·뉴질랜드", "oceania"],
    ["oceania-pacific", "태평양 제도", "oceania"],
    ["water-pacific", "태평양", "water"],
    ["water-atlantic", "대서양", "water"],
    ["water-indian", "인도양", "water"],
    ["water-southern", "남극해", "water"],
    ["water-arctic", "북극해", "water"],
    ["water-mediterranean", "지중해", "water"],
    ["water-black", "흑해", "water"],
    ["water-red", "홍해", "water"],
    ["water-baltic", "발트해", "water"],
    ["water-caribbean", "카리브해", "water"],
    ["water-east-asia", "동아시아 해역", "water"],
    ["water-other", "기타 해역", "water"],
    ["korea", "한반도·주변 섬", "asia-east"],
    ["korea-eight-provinces", "조선 8도", "korea"],
  ].map(([id, label, parent]) =>
    facet(`region:${id}`, label, "region", `region:${parent}`),
  ),
  ...[
    ["gyeonggi", "경기도"],
    ["gangwon", "강원도"],
    ["chungcheong", "충청도"],
    ["jeolla", "전라도"],
    ["gyeongsang", "경상도"],
    ["hwanghae", "황해도"],
    ["pyeongan", "평안도"],
    ["hamgyeong", "함경도"],
  ].map(([id, label]) =>
    facet(
      `region:korea-${id}`,
      label,
      "region",
      "region:korea-eight-provinces",
    ),
  ),
  facet("region:unconfirmed", "지역 미확인", "region"),
  ...[
    ["politics", "정치·제도"],
    ["society", "사회·생활"],
    ["thought", "사상·종교"],
    ["culture", "문화·학문"],
    ["war-diplomacy", "전쟁·외교"],
    ["people", "인물"],
    ["geography", "지리·장소"],
  ].map(([id, label]) => facet(`topic:${id}`, label, "topic")),
  ...[
    ["government", "관직·통치 기구", "politics"],
    ["law", "법과 제도", "politics"],
    ["land-tax", "토지·조세", "politics"],
    ["political-groups", "정치 세력", "politics"],
    ["political-events", "정치 사건", "politics"],
    ["social-order", "신분·사회", "society"],
    ["rites", "의례·생활", "society"],
    ["confucianism", "유교·성리학", "thought"],
    ["buddhism", "불교", "thought"],
    ["education", "교육·학문", "culture"],
    ["literature", "역사·문학", "culture"],
    ["art", "미술·도자기", "culture"],
    ["science", "과학·기술", "culture"],
    ["printing", "인쇄·문자", "culture"],
    ["battles", "전쟁·전투", "war-diplomacy"],
    ["military", "군사", "war-diplomacy"],
    ["diplomacy", "외교", "war-diplomacy"],
    ["rulers", "군주·통치자", "people"],
    ["scholars", "정치가·학자", "people"],
    ["generals", "장수", "people"],
    ["artists", "예술가", "people"],
    ["religious-people", "종교인", "people"],
    ["settlement", "도시·취락", "geography"],
    ["site", "유적·건축", "geography"],
    ["country", "국가·정치 영역", "geography"],
    ["region", "역사·지리 지역", "geography"],
    ["landform", "자연 지형", "geography"],
    ["museum", "박물관·기념관", "geography"],
    ["water", "하천·수역", "landform"],
    ["mountain", "산·산맥", "landform"],
    ["island", "섬", "landform"],
    ["desert", "사막", "landform"],
  ].map(([id, label, parent]) =>
    facet(`topic:${id}`, label, "topic", `topic:${parent}`),
  ),
];

const byId = new Map(historyDictionaryFacets.map((item) => [item.id, item]));

export const getHistoryDictionaryFacet = (id: string) => byId.get(id);

export const expandHistoryDictionaryFacetIds = (
  ids: readonly string[],
): string[] => {
  const expanded = new Set<string>();
  for (const id of ids) {
    let current = byId.get(id);
    if (!current) throw new Error(`Unknown dictionary facet: ${id}`);
    const chain = new Set<string>();
    while (current) {
      if (chain.has(current.id))
        throw new Error(`Cyclic dictionary facet: ${id}`);
      chain.add(current.id);
      expanded.add(current.id);
      if (!current.parentId) break;
      const parent = byId.get(current.parentId);
      if (!parent)
        throw new Error(`Missing dictionary facet parent: ${current.parentId}`);
      current = parent;
    }
  }
  return historyDictionaryFacets
    .filter((item) => expanded.has(item.id))
    .map((item) => item.id);
};

type FacetedTerm = { facetIds: readonly string[] };

export const getHistoryDictionaryTermFacets = (
  termOrIds: FacetedTerm | readonly string[],
  group?: HistoryDictionaryFacetGroup,
): HistoryDictionaryFacet[] => {
  const ids: readonly string[] =
    "facetIds" in termOrIds ? termOrIds.facetIds : termOrIds;
  const selected = new Set(ids);
  return historyDictionaryFacets.filter(
    (item) => selected.has(item.id) && (!group || item.group === group),
  );
};

/** OR within a facet group; AND between groups. Unknown filters never match. */
export const matchesHistoryDictionaryFacets = (
  term: FacetedTerm,
  selectedIds: readonly string[],
): boolean => {
  const groups = new Map<HistoryDictionaryFacetGroup, string[]>();
  for (const id of selectedIds) {
    const item = byId.get(id);
    if (!item) return false;
    groups.set(item.group, [...(groups.get(item.group) || []), id]);
  }
  return [...groups.values()].every((ids) =>
    ids.some((id) => term.facetIds.includes(id)),
  );
};
