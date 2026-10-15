/**
 * Build an offline, editorial Joseon eight-province navigation index.
 * Exact canonical names only: no geocoding, rectangles, alias or substring inference.
 * The scope is a late-Joseon teaching region, not jurisdiction at every story date.
 * See docs/reviews/history-atlas-korea-regions.sources.json for evidence and limits.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { format } from "prettier";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      require: (name) => {
        if (!name.startsWith("."))
          throw new Error(`Nonlocal data dependency: ${name}`);
        return load(path.resolve(path.dirname(file), name + ".ts"));
      },
    },
  );
  return exports;
}
const { historyAtlasDataset: dataset } = load(
  path.join(root, "src/data/historyAtlasContent.ts"),
);
const koreaEntries = dataset.entries.filter((entry) =>
  entry.unitId.startsWith("korea-"),
);
const koreaIds = new Set(koreaEntries.map((entry) => entry.placeId));
const places = dataset.places.filter((place) => koreaIds.has(place.id));
const canonicalKey = (name) => name.replace(/\s+/gu, "");
const byName = new Map();
for (const place of places) {
  const key = canonicalKey(place.name);
  if (byName.has(key))
    throw new Error(`Ambiguous canonical name: ${place.name}`);
  byName.set(key, place);
}

// A site's named town/complex comes from the existing textbook inventory. Town
// membership is checked against the historical administrative sources below.
// Seoul and Kaesong are grouped with Gyeonggi for navigation, not represented as
// subordinate counties; independent capital/yusu administration is preserved.
const groups = {
  gyeonggi: `전곡리|암사동|송악 · 개경|강화도|한양|남한산성|수원|인천|판문점|숭례문|석촌동 고분|송파|북한산|아차산 보루|풍납동 토성|이성산성|하남|덕적도|한산(서울)|만월대|안성|양주목|광주(경기)|경기|경기도|정주(개풍)|현릉|처인성|죽주|용인|삼랑성|승천부|교동현|교동도|석모도|보문사|전등사|마니산|문수산|참성단|공민왕릉|강화산성|개성 성균관|벽란도|덕물산|광덕산|풍덕|경천사지|양주|경복궁|종묘|종로|남산 봉수대|여주|세종대왕릉역|청계천|심곡 서원|숭양 서원|행주|삼전도|숙정문|흥인지문|돈의문|마포진|동작진|한강진|신천진|삼전도비|광릉 나루터|수원 화성|성균관 탕평비|규장각|송파장|옥호정|부평|명례방|명동성당|근정전|우정총국|독립문|영은문|탑골 공원|제암리|화성|덕수궁|조선 총독부|종로 경찰서|동양 척식 주식회사|조선 식산 은행|신민당사|창덕궁|연천|북한산 진흥왕 순수비|부천|만부교|백련사(강화)|적석사|별립산|고려산|진강산|봉천산|국자감|솔성재|고달사지|북악산|남산(서울)|인왕산|육조 거리|화성 행궁|서장대(수원 화성)|장안문|서북 공심돈|남양주|봉선사|황궁우|환구단|양화진|평화 시장|개성 공단|파주|몽촌토성|한성백제박물관|낙성대|관악|철산(벽란도 인근)|선죽교|하사창동|경천사지 10층 석탑|성균관(서울)|창경궁|경회루|압구정|행주산성|팔달문|주합루|영통동|죽산|러시아 공사관|서울역|성남|안양|광화문 광장|중구(서울)|문산역|불교 중앙 박물관|북산(개경)|고려대학교 박물관|호림 박물관|경희궁|경복궁 간의대|정릉동 행궁 별전|경성 방직 주식회사|대한민국 역사 박물관|한성 전화소|서대문|청량리|서울 지하철 1호선|한성여중|동성고|국가 인권 위원회|선원사|처인부곡|국립 고궁 박물관|이화여자대학교 박물관|간송 미술관|국립 한글 박물관|압구정동|육군사관학교 육군 박물관|성균관대학교|한국은행 화폐 박물관|숭실대학교 기독교 박물관|실학 박물관|성신여자대학교 박물관|삼성 미술관 리움|서울대학교 박물관`,
  gangwon: `횡성|울릉도|회양|강릉|철원|원주|춘천|영월|굴산사|흥녕사|사자산 선문|사굴산 선문|궁예 도성|동주(철원)|춘주|울진|평창|월정사|강원도|오죽헌|금강산|김화|대화장|인제|서도(독도)|동도(독도)|석도|독도|우산도|삼척|강원특별자치도|속초|아바이 마을|양양|흥법사지|평해|소양강창|흥원창|정선|홍천|죽변|울도군|고성(강원)|오산리 집터 유적|월정사 8각 9층 석탑|법천사지 지광 국사 탑|태백|상원사|명주(삼국사기)|죽도(울릉도 부속섬)`,
  chungcheong: `웅진|사비|청주|충주 고구려비|단양 적성|옥천|공산성|부소산성|충주|탑평리 7층 석탑|황산벌|삼년산성|임존성|삼충사|무령왕릉|서산 용현리 마애여래 삼존상|성주사|성주산 선문|홍성|홍주|논산|개태사|명학소|충주성|직산|천안|홍산|관촉사|예산|수덕사|충청도|괴산|화양 서원|돈암 서원|은진|강경장|회덕|연산|청안|당진|아산|제천|보은|우금치|대전|단양|의림지|백마강|단양 적성비|서산|용현리|능산리 고분|사비성|운천동|명학소 민중 봉기 기념탑|가흥창|공진창|법주사 팔상전|청산|목천|금굴|수양개|두루봉 동굴|점말 동굴|구낭굴|상시|석장리|보령|정림사지|능산리 1호분|용두사지 철당간|수덕사 대웅전|청주 고인쇄 박물관|현충사|덕산|국립 부여 박물관|부여 정림사지 5층 석탑|흥덕사|유성|독립 기념관`,
  jeolla: `청해진|제주도|전주|광주|화순|영암|순창|탐라|금마저|왕인 박사 유적|미륵사|익산|완산|남원|완도|곡성|금산사|보림사|태안사|실상사|가지산 선문|동리산 선문|실상산 선문|선암사|화순 쌍봉사|나주|고창|김제|승주목|전라도|승주|순천|영광|담양|장흥|용장성|진도|항파두리|황산(운봉)|운봉|군산|송광사|신안|능주|장성|필암 서원|태인|정읍|금산|고산(전북)|부안|함평|무성 서원|진산|강진|선운사 동불암지|삼례|고부|금구|무장|황룡촌|황토현|목포|암태도|제주 4·3 평화 공원|금남로|벽골제|애월|영산창|법성포창|조광조 적려 유허비|해남|여수|빌레못 동굴|옥구|왕궁리 유적|미륵사지 석탑|장도(완도)|다산 초당|광산|제주시|서귀포|무안|광양|봉개|쌍봉사 철감선사탑|장보고 기념관|소쇄원|전주성|백산(부안)|전라남도 도청|5·18 민주화 운동 기록관|국립 해양 유산 연구소|탐라총관부|어진 박물관|목포 해양 유물 전시관|김제 금산사 미륵전|구례 화엄사 각황전|해남 대흥사 무량수전`,
  gyeongsang: `김해|금성|울산항|안동|한산도|진주|부산|대구|고령|구지봉|수로왕릉|경주 월성|창녕|고성(경남)|함안|성주|비슬산|장산|호우총|지산동 고분군|경주 배동|분황사|황남대총|천마총|부부총|노서동|상주|태종 무열왕릉비|해인사 길상탑|감은사|동궁과 월지|합천|영주|문경|양산|봉암사|부석사|봉림사|통도사|희양산 선문|봉림산 선문|불국사|불국사 대웅전|다보탑|불국사 3층 석탑|석굴암|원성왕릉|선산|태사묘|팔공산|비로봉(팔공산)|경상도|해평|합주|의성부|의성|운문|밀성|황룡사|부인사|동래|합포|창원|관음포|남해(경남)|영호루|해인사|해인사 장경판전|염포|울산|부산포|제포|진해|병산 서원|만대루|존덕사|입교당|도산 서원|영남|함양|소수 서원|옥산 서원|남계 서원|예안|노량|의령|통영|부산진|마산포장|거창|밀양|단성|군위|개령|진주성|도동 서원|달성|영천|마산|부산 경찰서|포항|포항 종합 제철|영도|공검지|수산제|복천동|고허촌|양산(경주 남산)|남산(경주)|창녕 척경비|금관총|분황사 모전 석탑|달서|식리총|대성동 고분|김유신묘|문무 대왕릉|견훤산성|토함산|불국사 극락전|불국사 비로전|공산(대구)|사천|흥사리|흥사리 매향비|부석사 무량수전|거제도|상덕사|전교당|광명실|하회마을|수영|경산|영산|하동|강서(부산)|다호리 유적|첨성대|하대(울산)|계림로|대야성|경주 역사 유적 지구|경주역|동방역|국립 경주 박물관|포석정지|남산동 동서 3층 석탑|칠불암 마애 불상군|감은사지 동서 3층 석탑|용장사곡 3층 석탑|구미|이천동 마애 여래 입상|개심사지|예천|봉정사 극락전|북구(울산)|장영실 과학동산|충익사|수운 최제우 유허지|양동마을|풍기|국채 보상 운동 기념비|중구(대구)|김천|황룡사 9층 목탑|경주 배동 석조 여래 삼존 입상|모량|청운교|백운교|자하문(불국사)|대웅전(불국사)|석가탑|고직사(병산서원)|동재(병산서원)|서재(병산서원)|옥포|당포|동래성|부산 박물관|개심사지 5층 석탑|경북대학교`,
  hwanghae: `재령|해주|광조사|수미산 선문|황주|동주(서흥)|신천|평주|평산|신은|신계|수안|황해도|배천|문회 서원|토산|봉산|옹진|연평도|안악 3호분|안악 1호분|안악|연안|몽금포|강령|송화|은율|봉주|성불사 응진전`,
  pyeongan: `평양|강서대묘|남포|수산리 고분|강서(평남)|평양성|청천강|안북부|안주|안북도호부|성주(고려북부)|정주(평안)|의주|귀주|흥화진|곽주|대화궁|귀주성|강계|초산|선주|철산|평안도|삭주|만포|위화도|우예|자성|여연|무창|4군|의순관|묘향산|용천|맹산|용골산성|철옹산성|백마산성|중강|박천|선천|곽산|송림(평안)|다복동|가산|태천|정주성|오산 학교|대성 학교|강동|덕흥리 고분|중화|장안성|구성|용산(귀주)|안주성|용암포|신의주|운산|은산|승리산 동굴|덕천|상원|검은모루 동굴|위원|안학궁|강동성|조선 중앙 역사 박물관`,
  hamgyeong: `백두산|두만강|마운령|황초령|비열홀|안변|정평|원산|화주|안변도호부|쌍성총관부|갑주|길주|함주|함흥|단천|함경도|회령|북청|경흥|경성(함경북도)|경원|온성|부령|종성|6진|노덕 서원|덕원|원산장|혜산|청진|흥남|함흥평야|이원|마운령 순수비|황초령 순수비|장진|삼수|신고산|보천보|갑산|성진|흥남 조선 질소 비료 공장|웅기|동관진|굴포리|무산|고산(함경)`,
  "outside-korea": `상경 용천부|상하이|충칭|로마|장안|헤이조쿄|카이펑|카라코룸|베이징|보스턴|파리|우창|에도 · 도쿄|난징|히로시마|한(중국)|동해|황해|만주|중국|국내성|졸본|부여(나라)|국동대혈|지린|오녀산성|랴오닝|동진|왜|요서|광개토 대왕릉비|서안평|후연|거란|숙신|동부여|요동|남조|톈산산맥|타클라마칸 사막|고비 사막|몽골고원|타슈켄트|호탄|사마르칸트|카슈가르|쿠처|투루판|둔황|뤄양|영주(중국)|등주|서역|티베트|페르가나|소그드|아프라시아브 궁전|타이완|교토|고류사|다카마쓰 고분|우즈베키스탄|페르시아|유라시아|시리아|일본|개모성|비사성|라이저우|현도성|요동성|신성|회원진|안시성|연군|임유관|산하이관|부여성|유성(중국)|백암성|통정진|박작성|건안성|오골성|돌궐|수(중국)|당|토번|원산만|남소성|동모산|천문령|성산자산성|헤이룽장|도다이사|쇼소인|우수리강|랴오허강|쑹화강|상경성|정효 공주 묘|산둥|구시나국|쿠시나가르|인도|중앙아시아|프랑스|하카타|마쓰바라|후쿠라|적산|쉬저우|제주(중국)|해주(중국)|초주|닝보|항저우|호독|쑤저우|양저우|사주|법화원|신라관|닝안|허룽|훈춘|발해관|영광탑|상경성 주작대로|러시아|연해주|영흥만|요|여진|금(중국)|몽골|원|쓰시마섬|만권당|다자이후|송|아라비아|베트남|명|시암|자와|류큐|후금|청|아리타|규슈|사가|책문|봉황성|랴오양|광닝|오사카|나고야|하마마쓰|이즈하라|가쓰모토|시모노세키|하이청|동관역|선양|에도성|고베|미국|영국|독일|이탈리아|오스트리아|헤이그|네덜란드|하얼빈역|블라디보스토크|미주|우한|영릉가|흥경성|삼원보|청산리|봉오동|쌍성보|옌안|대전자령|신흥 무관 학교|만주국|모스크바|백악관|홍콩|황허강|눙안|각저총|읍루|산성하 고분군|이소노카미 신궁|북조|카샨|호류사|남제|양(남조)|진(남조)|목저성|오회분 4호묘|사해점촌|창장강|크라스키노|상경성 어화원|상경성 제1절터|상경성 제2절터|상경성 제3절터|상경성 제4절터|상경성 제5절터|상경성 제6절터|상경성 제7절터|상경성 제8절터|상경성 제9절터|정안국|회녕(중국)|북송|남송|서하|동여진|오카야마|조라쿠사|유럽|아프리카|미시마|히코네|함부르크|오키섬|운슈|이주|시마네현|치장|마카오|전장|창사|류저우|광저우|사도하자|싱징|둔화|옌지|룽징|서전서숙|명동 학교|신흥 강습소|북로 군정서 사관 연성소|지안|왕칭|석현|스리핑|미산|한흥동|류허|단둥|하얼빈|홍경|창춘|스보보드니|훙커우 공원|소련|간도|나가사키|얄타|안투|해성|진뉴산|먀오허우산|생 아슐|영구|다롄|양사오|안달루시아|에스파냐|스톤헨지|윌트셔|연(중국)|전연|북위|전진|남해|장군총|무용총|개원|정혜 공주 묘|니콜라예프카 성터|산둥반도|신라방|신라소|신라원|태평양|센소사|태국|인도네시아|오키나와|동남아시아|초나라|귀무덤|열하|조양문|더레이프|아산만|화베이|남아메리카|지린성|그리스|서아시아|쓰루가|교토 국립 박물관|진국(발해)|헤이룽장성|중경성|장안성(당)|프랑스 국립 도서관|둔황 석굴|일본 궁내청|류코쿠대학|덴리대학|이마에몬 미술관|플라시|금릉 기기국|중화민국|미얀마|서독|유리창 거리|행산역|줘저우|지난|무굴 제국|진(중국)|도호쿠대학|흠천감`,
};

const deferredNames = new Map([
  [
    "동부여",
    "고대 정치 집단의 비정과 범위에 논의가 있어 8도 안팎을 단정하지 않음",
  ],
  [
    "진국(발해)",
    "발해 초기 정치 집단의 영역을 단일 권역이나 8도 밖으로 단정하지 않음",
  ],
  [
    "유라시아",
    "한반도도 포함하는 대륙 규모의 이름이므로 8도 밖으로 분류하지 않음",
  ],
]);
const rules = [];
for (const [region, names] of Object.entries(groups)) {
  for (const name of names.split("|")) {
    if (deferredNames.has(name)) continue;
    // Both source pages (atlas-lee 73, 75) say Tang Chang'an, not Pyongyang.
    const confirmedRegion = name === "장안성" ? "outside-korea" : region;
    rules.push({
      name,
      regionIds: [confirmedRegion],
      basis:
        confirmedRegion === "outside-korea"
          ? "textbook-location-outside-eight-provinces"
          : "named-locality-and-historical-province",
      sourceIds:
        confirmedRegion === "outside-korea"
          ? ["textbooks"]
          : ["textbooks", `gazetteer-${confirmedRegion}`],
    });
  }
}
const crossProvince = [
  {
    names: "한강|남한강",
    regions: ["gyeonggi", "gangwon", "chungcheong"],
    reason: "강원 영월·충청 충주·경기 여주와 한양으로 이어지는 물길",
  },
  {
    names: "낙동강",
    regions: ["gangwon", "gyeongsang"],
    reason: "태백 황지 발원지와 경상도 본류",
  },
  {
    names: "금강",
    regions: ["chungcheong", "jeolla"],
    reason: "전라도 발원지에서 충청도 옥천·공주·부여로 이어지는 물길",
  },
  {
    names: "압록강",
    regions: ["pyeongan", "hamgyeong"],
    reason: "평안도와 함경도의 북쪽 변경을 따라 흐르는 물길",
  },
  {
    names: "철령",
    regions: ["gangwon", "hamgyeong"],
    reason: "강원도 회양과 함경도 안변 사이의 고개",
  },
  {
    names: "태백산",
    regions: ["gangwon", "gyeongsang"],
    reason: "강원도 태백·영월과 경상도 봉화에 걸친 산",
  },
  {
    names: "백제 역사 유적 지구",
    regions: ["chungcheong", "jeolla"],
    reason: "공주·부여·익산의 유적으로 이루어진 연속유산",
  },
  {
    names: "대동강",
    regions: ["hwanghae", "pyeongan"],
    reason: "평양을 지나 평안·황해 양쪽과 맞닿는 하류의 물길",
    sourceIds: ["daedong"],
  },
  {
    names: "예성강",
    regions: ["gyeonggi", "hwanghae"],
    reason: "황해 수안·평산에서 개성 서쪽 경기·황해 접경으로 이어지는 물길",
    sourceIds: ["gazetteer-hwanghae", "gaepung"],
  },
  {
    names: "섬진강",
    regions: ["jeolla", "gyeongsang"],
    reason:
      "전라 진안·임실·곡성·구례에서 경상 하동과 전라 광양 사이로 흐르는 물길",
    sourceIds: ["seomjin"],
  },
  {
    names: "지리산",
    regions: ["jeolla", "gyeongsang"],
    reason: "전라 남원·구례와 경상 함양·산청·하동에 걸친 산",
    sourceIds: ["jirisan"],
  },
  {
    names: "덕유산",
    regions: ["jeolla", "gyeongsang"],
    reason: "전라 무주·장수와 경상 거창·함양에 걸친 산",
    sourceIds: ["deogyusan"],
  },
  {
    names: "추풍령|조령",
    regions: ["chungcheong", "gyeongsang"],
    reason: "충청·경상 사이의 고개와 교통로",
    sourceIds: ["passes"],
  },
  {
    names: "한려 해상 국립 공원",
    regions: ["jeolla", "gyeongsang", "outside-korea"],
    reason: "여수에서 거제까지의 섬·해안과 그 사이 해역을 아우르는 공원",
    sourceIds: ["hallyeo"],
  },
];
for (const rule of crossProvince)
  for (const name of rule.names.split("|"))
    rules.push({
      name,
      regionIds: rule.regions,
      basis: "multiple-provinces",
      reason: rule.reason,
      sourceIds: rule.sourceIds ?? [
        "textbooks",
        ...rule.regions.map((id) => `gazetteer-${id}`),
      ],
    });

const exceptionSources = new Map([
  ...["한양", "송악 · 개경", "개성 성균관", "만월대", "개성 공단"].map((n) => [
    n,
    ["capital-exception", "late-province-academies"],
  ]),
  ...["철원", "동주(철원)", "궁예 도성", "김화"].map((n) => [
    n,
    ["late-province-academies"],
  ]),
  ...[
    "울릉도",
    "독도",
    "서도(독도)",
    "동도(독도)",
    "석도",
    "우산도",
    "울도군",
    "죽도(울릉도 부속섬)",
  ].map((n) => [n, ["ulleung-dokdo"]]),
  ...["안변", "원산", "덕원", "원산장", "비열홀", "안변도호부"].map((n) => [
    n,
    ["anbyeon"],
  ]),
  ...["제주도", "탐라", "항파두리", "제주시", "서귀포", "탐라총관부"].map(
    (n) => [n, ["jeju"]],
  ),
  ["금산", ["geumsan"]],
  ["진산", ["jinsan"]],
  ["울진", ["uljin"]],
  ["평해", ["pyeonghae"]],
  ["죽산", ["jukssan"]],
  ["낙동강", ["nakdong"]],
  ["백제 역사 유적 지구", ["baekje-unesco"]],
  ["태백산", ["taebaeksan"]],
]);
for (const rule of rules)
  rule.sourceIds = [
    ...new Set([...rule.sourceIds, ...(exceptionSources.get(rule.name) ?? [])]),
  ];

const assigned = new Map();
for (const rule of rules) {
  const place = byName.get(canonicalKey(rule.name));
  if (!place) throw new Error(`Unknown canonical name: ${rule.name}`);
  if (assigned.has(place.id))
    throw new Error(`Duplicate classification: ${rule.name}`);
  assigned.set(place.id, { ...rule, placeId: place.id, name: place.name });
}
const mapping = Object.fromEntries(
  places.map((place) => [place.id, assigned.get(place.id)?.regionIds ?? []]),
);
const outputPath = path.join(root, "src/data/historyAtlasKoreaRegions.ts");
fs.writeFileSync(
  outputPath,
  await format(
    `// Generated by scripts/build-history-atlas-korea-regions.mjs.\n// Late-Joseon navigation regions; not boundaries at every story date.\n// Empty lists deliberately retain unresolved or broad historical places.\nexport const koreaAtlasRegionIdsByPlace: Record<string, string[]> = ${JSON.stringify(mapping, null, 2)};\n`,
    { parser: "typescript" },
  ),
);
const counts = Object.fromEntries(
  Object.keys(groups).map((id) => [
    id,
    places.filter((p) => mapping[p.id].includes(id)).length,
  ]),
);
const unclassified = places
  .filter((p) => !mapping[p.id].length)
  .map((p) => ({
    placeId: p.id,
    name: p.name,
    kind: p.kind ?? null,
    reason:
      deferredNames.get(p.name) ??
      (p.kind === "country" || p.kind === "region"
        ? "광역·옛 행정영역의 시대별 범위를 8도 탐색권역에 대응할 추가 근거 필요"
        : "동명 여부·위치 또는 여러 구간의 옛 소속을 확정할 추가 근거 필요"),
  }));
const coverage = {
  schemaVersion: 1,
  reviewedAt: "2026-10-15",
  scope: "조선 후기 8도 탐색권역",
  total: places.length,
  classified: assigned.size,
  unclassifiedCount: unclassified.length,
  counts,
  method:
    "기존 교과서 장소의 정규 지명과 위치 맥락을 수기 대조한 명시 목록. 좌표·현행 시도·별칭의 자동 치환 없음. 한양·개성은 경기 탐색권역으로 묶으며 직할 관할을 경기 소속으로 바꾸어 주장하지 않음.",
  boundaries:
    "정밀 경계나 모든 시대의 관할을 표시하는 자료가 아니다. 이름이 같은 별개 장소는 기존 place ID를 유지한다. 해외·바다는 8도 밖, 판단을 보류한 지명은 빈 목록이다.",
  sources: [
    {
      id: "historical-gazetteer",
      title: "세종실록 지리지 읍목 목록 — 원래 군현명 확인",
      url: "https://db.history.go.kr/id/hb_031_01_000451",
      note: "후기 변경은 아래 예외 근거로 보정. 15세기 경계를 후기 경계로 그대로 사용하지 않음.",
    },
    ...Object.entries({
      gyeonggi: "040",
      chungcheong: "050",
      gyeongsang: "060",
      jeolla: "070",
      hwanghae: "080",
      gangwon: "090",
      pyeongan: "100",
      hamgyeong: "110",
    }).map(([regionId, suffix]) => ({
      id: `gazetteer-${regionId}`,
      title: `세종실록 지리지 ${regionId}`,
      url: `https://sillok.history.go.kr/id/kda_400${suffix}`,
    })),
    {
      id: "late-province-academies",
      title: "고종 8년 3월 20일 — 도별 존치 서원 명단",
      url: "https://sillok.history.go.kr/id/kza_10803020_004",
      note: "개성·숭양서원은 경기, 철원·김화는 강원, 진주·안동·예안 등 도별 소속 대조.",
    },
    {
      id: "capital-exception",
      title: "국사편찬위원회 — 한성·개성 및 사도 직할 행정",
      url: "https://contents.history.go.kr/front/nh/view.do?levelId=nh_023_0040_0040_0020",
      note: "경기 탐색권역과 직할 행정관할을 구별.",
    },
    {
      id: "jeju",
      title: "세종실록 지리지 전라도 제주목",
      url: "https://sillok.history.go.kr/id/kda_40007005",
    },
    {
      id: "geumsan",
      title: "세종실록 지리지 전라도 전주부 금산군",
      url: "https://sillok.history.go.kr/id/kda_40007001_002",
    },
    {
      id: "jinsan",
      title: "한국학중앙연구원 — 진산군읍지",
      url: "https://encykorea.aks.ac.kr/Article/E0054725",
    },
    {
      id: "uljin",
      title: "중종 30년 3월 1일 — 강원도 울진현",
      url: "https://sillok.history.go.kr/id/kka_13003001_002",
    },
    {
      id: "pyeonghae",
      title: "한국학중앙연구원 — 평해군읍지",
      url: "https://encykorea.aks.ac.kr/Article/E0060091",
    },
    {
      id: "ulleung-dokdo",
      title: "국회도서관 독도 — 강원도 울진과 우산·무릉",
      url: "https://dokdo.nanet.go.kr/dokdo/getFrontData.dokdo?bbsCD=A1002&bbsSID=6792",
      note: "우산도·석도는 원문 이름을 유지하며 해당 이름과 섬의 동일성을 새로 단정하지 않음.",
    },
    {
      id: "anbyeon",
      title: "규장각 고지도 안변부 — 옛 함경도 안변과 철령",
      url: "https://kyudb.snu.ac.kr/book/text.do?book_cate=GZD01&book_cd=GM99998_00&focus=d1sd13&mid=GZD",
    },
    {
      id: "jukssan",
      title: "경기도메모리 연혁 — 경기 죽산현",
      url: "https://memory.library.kr/files/original/0b8b81829eec7ffdebf5d2c73691f867.pdf",
    },
    {
      id: "nakdong",
      title: "국가기록원 — 낙동강 발원지 황지",
      url: "https://theme.archives.go.kr/next/koreaOfRecord/nakdonggangRiver.do",
    },
    {
      id: "daedong",
      title: "한국학중앙연구원 — 황해남도와 대동강 하류의 경계",
      url: "https://encykorea.aks.ac.kr/Article/E0065384",
    },
    {
      id: "gaepung",
      title: "한국학중앙연구원 — 개풍군과 예성강",
      url: "https://encykorea.aks.ac.kr/Article/E0001748",
    },
    {
      id: "seomjin",
      title: "영산강유역환경청 — 섬진강 유역현황",
      url: "https://mcee.go.kr/ysg/web/index.do?menuId=4532",
    },
    {
      id: "jirisan",
      title: "국립공원공단 — 지리산의 남원·구례·함양·산청·하동",
      url: "https://knps.or.kr/front/portal/visit/visitCourseMain.do?menuNo=7020100&parkId=120100",
    },
    {
      id: "deogyusan",
      title: "국립공원공단 — 덕유산의 무주·장수·거창·함양",
      url: "https://public.knps.or.kr/front/portal/visit/visitCourseMain.do?menuNo=7020002&parkId=120800",
    },
    {
      id: "hallyeo",
      title: "국립공원공단 — 한려해상 여수·거제 구간",
      url: "https://contents.knps.or.kr/front/portal/visit/visitCourseMain.do?menuNo=7020002&parkId=120300",
    },
    {
      id: "passes",
      title: "고종 27년 3월 27일 — 조령·추풍령의 문경·괴산·황간 교통로",
      url: "https://sillok.history.go.kr/id/kza_12703027_007",
    },
    {
      id: "taebaeksan",
      title: "국립공원공단 — 태백산",
      url: "https://public.knps.or.kr/front/portal/visit/visitCourseMain.do?menuNo=8000275&parkId=122200",
    },
    {
      id: "baekje-unesco",
      title: "유네스코 — 공주·부여·익산 백제역사유적지구",
      url: "https://whc.unesco.org/en/list/1477/",
    },
    {
      id: "textbooks",
      title: "기존 교과서 장소·시대별 항목의 검수된 원문 인용",
      note: "아래 assignments의 textbookCitations는 장소를 찾는 근거이며, 현대 유적의 조선시대 존재를 주장하지 않는다. 원문은 저장소에 복제하지 않음.",
    },
  ],
  exceptions: [
    {
      names: ["한양", "송악 · 개경"],
      regions: ["gyeonggi"],
      note: "직할 수도·유수부도 경기 탐색권역에 포함. 관할 종속을 뜻하지 않음.",
    },
    {
      names: ["철원", "김화", "울진", "평해", "울릉도", "독도"],
      regions: ["gangwon"],
      note: "조선 후기 기준. 현대 강원/경북 경계를 자동 치환하지 않음.",
    },
    {
      names: ["금산", "진산", "제주도"],
      regions: ["jeolla"],
      note: "현대 충남·제주와 달리 조선시대 전라권역.",
    },
    {
      names: ["안변", "원산", "덕원"],
      regions: ["hamgyeong"],
      note: "현대 북한 강원도를 소급하지 않음.",
    },
    {
      names: ["연평도", "옹진"],
      regions: ["hwanghae"],
      note: "현대 인천 광역행정 경계로 치환하지 않음.",
    },
  ],
  assignments: places
    .filter((p) => assigned.has(p.id))
    .map((p) => ({
      ...assigned.get(p.id),
      textbookCitations: [
        ...new Map(
          koreaEntries
            .filter((e) => e.placeId === p.id)
            .flatMap((e) => e.citations)
            .map((c) => [
              `${c.sourceId}:${c.pdfPage}`,
              { sourceId: c.sourceId, pdfPage: c.pdfPage },
            ]),
        ).values(),
      ],
    })),
  unclassified,
};
fs.writeFileSync(
  path.join(root, "docs/reviews/history-atlas-korea-regions.sources.json"),
  JSON.stringify(coverage, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      total: places.length,
      classified: assigned.size,
      unclassified: unclassified.length,
      counts,
    },
    null,
    2,
  ),
);
