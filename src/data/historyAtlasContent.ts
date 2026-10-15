import type { AtlasDataset, AtlasPlace } from "../lib/historyAtlas";
import { addAtlasHistoricalStories } from "../lib/historyAtlasStories";
import { profileHistoricalStories } from "./historyAtlasProfileStories";
import {
  koreaHistoricalStories,
  koreaHistoricalEntryCorrections,
} from "./historyAtlasKoreaStories";
import {
  worldHistoricalStories,
  worldHistoricalEntryCorrections,
} from "./historyAtlasWorldStories";
import { historyAtlasEras, originalAtlasEntryEras } from "./historyAtlasEras";
import {
  koreaExpansionEntries,
  koreaExpansionPlaces,
  koreaPlaceUpdates,
} from "./historyAtlasKoreaExpansion";
import {
  worldExpansionEntries,
  worldExpansionPlaces,
  worldPlaceUpdates,
} from "./historyAtlasWorldExpansion";

// Original summaries of the supplied textbooks; source PDFs and extracted text are not shipped.
// Coordinates are representative locations, not reconstructed historical boundaries.
const originalHistoryAtlasDataset: AtlasDataset = {
  sources: [
    {
      id: "history1",
      title: "비상 중학교 역사① (이병인)",
      edition: "이병인 저자본 · 제공 PDF",
    },
    {
      id: "history2-lee",
      title: "비상 중학교 역사② (이병인)",
      edition: "이병인 저자본 · 제공 PDF",
    },
    {
      id: "atlas-lee",
      title: "비상 중학교 역사 부도 (이병인)",
      edition: "이병인 저자본 · 제공 PDF",
    },
    {
      id: "atlas-2022",
      title: "비상 중학교 역사 부도",
      edition: "2022 개정 · 제공 PDF",
    },
  ],
  units: [
    {
      id: "korea-ancient",
      subject: "korea",
      title: "선사 문화와 고대 국가",
      period: "선사 시대~삼국 시대",
      bounds: [121, 33, 132, 43],
    },
    {
      id: "korea-north-south",
      subject: "korea",
      title: "통일 신라와 발해",
      period: "7~10세기",
      bounds: [118, 32, 135, 47],
    },
    {
      id: "korea-goryeo",
      subject: "korea",
      title: "고려의 성립과 변화",
      period: "10~14세기",
      bounds: [123, 32, 131, 41],
    },
    {
      id: "korea-joseon",
      subject: "korea",
      title: "조선의 성립과 발전",
      period: "14~17세기",
      bounds: [124, 33, 132, 40],
    },
    {
      id: "korea-late-joseon",
      subject: "korea",
      title: "조선 사회의 변화",
      period: "17~19세기",
      bounds: [123, 33, 131, 40],
    },
    {
      id: "korea-modern",
      subject: "korea",
      title: "근현대 사회와 민주주의",
      period: "19~21세기",
      bounds: [103, 28, 132, 41],
    },
    {
      id: "world-ancient",
      subject: "world",
      title: "고대 문명과 국가",
      period: "기원전~고대",
      bounds: [7, 15, 83, 44],
    },
    {
      id: "world-religions",
      subject: "world",
      title: "종교와 지역 문화",
      period: "6~9세기 중심",
      bounds: [20, 10, 142, 45],
    },
    {
      id: "world-exchange",
      subject: "world",
      title: "지역 세계의 교류",
      period: "10~17세기",
      bounds: [-14, 3, 143, 56],
    },
    {
      id: "world-nations",
      subject: "world",
      title: "혁명과 국민 국가",
      period: "18~20세기 초",
      bounds: [-82, 20, 145, 58],
    },
    {
      id: "world-wars",
      subject: "world",
      title: "세계 대전과 평화",
      period: "1914~1945년",
      bounds: [-6, 27, 145, 55],
    },
    {
      id: "world-contemporary",
      subject: "world",
      title: "냉전과 현대 세계",
      period: "20세기 후반",
      bounds: [5, -10, 116, 57],
    },
  ],
  places: [
    {
      id: "yeoncheon",
      name: "전곡리",
      modernName: "경기 연천 전곡리",
      aliases: ["연천"],
      coordinates: [127.06, 38.02],
      locationNote:
        "유적 일대의 대표 위치입니다. 유적의 경계나 세부 발굴 지점을 뜻하지 않습니다.",
    },
    {
      id: "amsa",
      name: "암사동",
      modernName: "서울 강동 암사동",
      aliases: ["서울 암사동"],
      coordinates: [127.13, 37.56],
      locationNote:
        "유적 일대의 대표 위치입니다. 유적의 경계나 세부 발굴 지점을 뜻하지 않습니다.",
    },
    {
      id: "pyongyang",
      name: "평양",
      modernName: "평양",
      aliases: ["서경"],
      coordinates: [125.75, 39.03],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "gongju",
      name: "웅진",
      modernName: "충남 공주",
      aliases: ["공주"],
      coordinates: [127.12, 36.46],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "buyeo",
      name: "사비",
      modernName: "충남 부여",
      aliases: ["부여"],
      coordinates: [126.91, 36.28],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "gimhae",
      name: "김해",
      modernName: "경남 김해",
      aliases: ["금관가야"],
      coordinates: [128.89, 35.23],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "gyeongju",
      name: "금성",
      modernName: "경북 경주",
      aliases: ["경주", "서라벌"],
      coordinates: [129.22, 35.84],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "sanggyeong",
      name: "상경 용천부",
      modernName: "중국 닝안 지역의 발해 상경성 유적",
      aliases: ["상경", "발해 상경성"],
      coordinates: [129.13, 44.11],
      locationNote:
        "유적 일대의 대표 위치입니다. 유적의 경계나 세부 발굴 지점을 뜻하지 않습니다.",
    },
    {
      id: "wando",
      name: "청해진",
      modernName: "전남 완도 장도 일대",
      aliases: ["완도", "장도"],
      coordinates: [126.71, 34.36],
      locationNote:
        "유적 일대의 대표 위치입니다. 유적의 경계나 세부 발굴 지점을 뜻하지 않습니다.",
    },
    {
      id: "ulsan",
      name: "울산항",
      modernName: "울산",
      aliases: ["울산"],
      coordinates: [129.31, 35.54],
      locationNote:
        "울산 지역의 대표 위치입니다. 통일 신라 때의 항구 위치나 해안선을 정밀하게 복원한 좌표가 아닙니다.",
    },
    {
      id: "kaesong",
      name: "송악 · 개경",
      modernName: "개성",
      aliases: ["송악", "개경", "개성"],
      coordinates: [126.55, 37.97],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "ganghwa",
      name: "강화도",
      modernName: "인천 강화",
      aliases: ["강화", "강도"],
      coordinates: [126.49, 37.75],
      locationNote:
        "강화도 중심 지역의 대표 위치입니다. 고려 궁궐이나 성곽의 정확한 위치를 뜻하지 않습니다.",
    },
    {
      id: "jeju",
      name: "제주도",
      modernName: "제주",
      aliases: ["탐라"],
      coordinates: [126.53, 33.42],
      locationNote:
        "제주도 일대의 대표 위치입니다. 삼별초의 개별 전투 지점이나 항파두리성의 정밀 좌표가 아닙니다.",
    },
    {
      id: "cheongju",
      name: "청주",
      modernName: "충북 청주",
      aliases: ["흥덕사", "직지"],
      coordinates: [127.47, 36.64],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "seoul",
      name: "한양",
      modernName: "서울",
      aliases: ["한성", "서울", "경성"],
      coordinates: [126.98, 37.57],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "andong",
      name: "안동",
      modernName: "경북 안동",
      aliases: ["병산 서원", "병산서원"],
      coordinates: [128.73, 36.57],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "hansando",
      name: "한산도",
      modernName: "경남 통영 한산도 일대",
      aliases: ["한산도 대첩", "통영"],
      coordinates: [128.48, 34.77],
      locationNote:
        "한산도 일대의 대표 위치입니다. 해전의 정확한 전투 범위나 함대 이동 경로를 뜻하지 않습니다.",
    },
    {
      id: "namhansanseong",
      name: "남한산성",
      modernName: "경기 광주 남한산성",
      aliases: ["병자호란"],
      coordinates: [127.18, 37.48],
      locationNote:
        "유적 일대의 대표 위치입니다. 유적의 경계나 세부 발굴 지점을 뜻하지 않습니다.",
    },
    {
      id: "suwon",
      name: "수원",
      modernName: "경기 수원",
      aliases: ["화성", "수원 화성"],
      coordinates: [127.01, 37.29],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "jinju",
      name: "진주",
      modernName: "경남 진주",
      aliases: ["진주 농민 봉기"],
      coordinates: [128.08, 35.18],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "busan",
      name: "부산",
      modernName: "부산",
      aliases: ["동래", "부산포"],
      coordinates: [129.07, 35.18],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "jeonju",
      name: "전주",
      modernName: "전북 전주",
      aliases: ["완산주", "전주성"],
      coordinates: [127.15, 35.82],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "daegu",
      name: "대구",
      modernName: "대구",
      aliases: ["국채 보상 운동"],
      coordinates: [128.6, 35.87],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "shanghai",
      name: "상하이",
      modernName: "중국 상하이",
      aliases: ["상해"],
      coordinates: [121.47, 31.23],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "chongqing",
      name: "충칭",
      modernName: "중국 충칭",
      aliases: ["중경", "한국 광복군"],
      coordinates: [106.55, 29.56],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "gwangju",
      name: "광주",
      modernName: "광주",
      aliases: ["5·18 민주화 운동"],
      coordinates: [126.92, 35.15],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "incheon",
      name: "인천",
      modernName: "인천",
      aliases: ["인천 상륙 작전"],
      coordinates: [126.65, 37.47],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "panmunjom",
      name: "판문점",
      modernName: "한반도 군사분계선의 판문점 일대",
      aliases: ["판문점 선언"],
      coordinates: [126.68, 37.96],
      locationNote:
        "판문점 일대의 대표 위치입니다. 군사분계선이나 시설의 경계를 나타내는 좌표가 아닙니다.",
    },
    {
      id: "ur",
      name: "우르",
      modernName: "이라크 남부 우르 유적",
      aliases: ["수메르", "메소포타미아"],
      coordinates: [46.1, 30.96],
      locationNote:
        "유적 일대의 대표 위치입니다. 유적의 경계나 세부 발굴 지점을 뜻하지 않습니다.",
    },
    {
      id: "giza",
      name: "기자",
      modernName: "이집트 기자 지역",
      aliases: ["피라미드", "기자 피라미드"],
      coordinates: [31.13, 29.98],
      locationNote:
        "유적 일대의 대표 위치입니다. 유적의 경계나 세부 발굴 지점을 뜻하지 않습니다.",
    },
    {
      id: "mohenjo-daro",
      name: "모헨조다로",
      modernName: "파키스탄 신드 지역의 모헨조다로 유적",
      aliases: ["인더스 문명"],
      coordinates: [68.14, 27.33],
      locationNote:
        "유적 일대의 대표 위치입니다. 유적의 경계나 세부 발굴 지점을 뜻하지 않습니다.",
    },
    {
      id: "athens",
      name: "아테네",
      modernName: "그리스 아테네",
      aliases: ["아테나이", "아크로폴리스"],
      coordinates: [23.73, 37.98],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "rome",
      name: "로마",
      modernName: "이탈리아 로마",
      aliases: ["로마 공화정"],
      coordinates: [12.5, 41.9],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "xian",
      name: "장안",
      modernName: "중국 시안 일대",
      aliases: ["시안", "서안", "대흥"],
      coordinates: [108.94, 34.27],
      locationNote:
        "현재 시안 일대의 대표 위치입니다. 한·당의 장안성과 현재 시가지의 범위는 서로 다릅니다.",
    },
    {
      id: "nara",
      name: "헤이조쿄",
      modernName: "일본 나라",
      aliases: ["나라", "나라 시대"],
      coordinates: [135.8, 34.69],
      locationNote:
        "현재 나라 일대의 대표 위치입니다. 고대 헤이조쿄의 경계를 나타내지 않습니다.",
    },
    {
      id: "mecca",
      name: "메카",
      modernName: "사우디아라비아 메카",
      aliases: ["이슬람교"],
      coordinates: [39.83, 21.42],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "baghdad",
      name: "바그다드",
      modernName: "이라크 바그다드",
      aliases: ["아바스 왕조"],
      coordinates: [44.37, 33.32],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "istanbul",
      name: "콘스탄티노폴리스 · 이스탄불",
      modernName: "튀르키예 이스탄불",
      aliases: ["콘스탄티노폴리스", "이스탄불", "비잔티움"],
      coordinates: [28.98, 41.01],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "kaifeng",
      name: "카이펑",
      modernName: "중국 카이펑",
      aliases: ["개봉", "변경"],
      coordinates: [114.31, 34.8],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "karakorum",
      name: "카라코룸",
      modernName: "몽골 하르호린 인근의 카라코룸 유적",
      aliases: ["하르호린"],
      coordinates: [102.82, 47.2],
      locationNote:
        "고대 카라코룸 유적 일대의 대표 위치입니다. 현재 하르호린 시가지와 같은 범위로 보지 않습니다.",
    },
    {
      id: "beijing",
      name: "베이징",
      modernName: "중국 베이징",
      aliases: ["북경", "대도", "자금성"],
      coordinates: [116.4, 39.9],
      locationNote:
        "현재 베이징 중심부의 대표 위치입니다. 원의 대도와 명·청의 수도는 시대별 도시 범위가 다릅니다.",
    },
    {
      id: "agra",
      name: "아그라",
      modernName: "인도 아그라",
      aliases: ["타지마할"],
      coordinates: [78.01, 27.18],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "lisbon",
      name: "리스본",
      modernName: "포르투갈 리스본",
      aliases: ["신항로 개척"],
      coordinates: [-9.14, 38.72],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "boston",
      name: "보스턴",
      modernName: "미국 보스턴",
      aliases: ["보스턴 차 사건"],
      coordinates: [-71.06, 42.36],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "philadelphia",
      name: "필라델피아",
      modernName: "미국 필라델피아",
      aliases: ["미국 독립 선언"],
      coordinates: [-75.16, 39.95],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "paris",
      name: "파리",
      modernName: "프랑스 파리",
      aliases: ["바스티유", "프랑스 혁명"],
      coordinates: [2.35, 48.86],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "manchester",
      name: "맨체스터",
      modernName: "영국 맨체스터",
      aliases: ["산업 혁명", "면직물"],
      coordinates: [-2.24, 53.48],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "wuchang",
      name: "우창",
      modernName: "중국 우한의 우창 지역",
      aliases: ["무창", "우한", "신해혁명"],
      coordinates: [114.3, 30.55],
      locationNote:
        "우한을 이루는 우창 지역의 대표 위치입니다. 우창과 오늘날 우한 전체를 같은 범위로 보지 않습니다.",
    },
    {
      id: "tokyo",
      name: "에도 · 도쿄",
      modernName: "일본 도쿄",
      aliases: ["에도", "도쿄", "동경"],
      coordinates: [139.76, 35.68],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "sarajevo",
      name: "사라예보",
      modernName: "보스니아 헤르체고비나 사라예보",
      aliases: ["사라예보 사건"],
      coordinates: [18.41, 43.86],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "versailles",
      name: "베르사유",
      modernName: "프랑스 베르사유",
      aliases: ["베르사유 조약", "베르사유 궁전"],
      coordinates: [2.13, 48.8],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "nanjing",
      name: "난징",
      modernName: "중국 난징",
      aliases: ["남경", "금릉"],
      coordinates: [118.8, 32.06],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "hiroshima",
      name: "히로시마",
      modernName: "일본 히로시마",
      aliases: ["원자 폭탄"],
      coordinates: [132.46, 34.39],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "bandung",
      name: "반둥",
      modernName: "인도네시아 반둥",
      aliases: ["아시아·아프리카 회의"],
      coordinates: [107.61, -6.92],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
    {
      id: "berlin",
      name: "베를린",
      modernName: "독일 베를린",
      aliases: ["베를린 장벽", "독일 통일"],
      coordinates: [13.4, 52.52],
      locationNote:
        "현재 도시 일대의 대표 위치입니다. 당시 도시의 경계나 개별 유적의 정밀 위치를 뜻하지 않습니다.",
    },
  ],
  entries: [
    {
      id: "k-yeoncheon",
      unitId: "korea-ancient",
      placeId: "yeoncheon",
      title: "주먹도끼가 보여 주는 구석기 문화",
      period: "구석기 시대",
      summary:
        "전곡리에서 발견된 주먹도끼는 돌의 양면을 다듬어 만든 구석기 도구이다.",
      significance:
        "사냥과 손질에 쓰인 도구를 통해 당시 사람들이 자연환경에 적응한 방식을 살펴볼 수 있다.",
      citations: [
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
      relatedPlaceIds: ["amsa"],
    },
    {
      id: "k-amsa",
      unitId: "korea-ancient",
      placeId: "amsa",
      title: "강가에 자리 잡은 신석기 마을",
      period: "신석기 시대",
      summary:
        "암사동은 움집을 짓고 정착한 신석기 사람들의 생활을 살펴볼 수 있는 유적이다.",
      significance:
        "농경과 어로, 토기 사용은 먹거리를 얻고 저장하는 방식이 달라졌음을 보여 준다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 10,
          printedPage: "12",
        },
      ],
      relatedPlaceIds: ["yeoncheon"],
    },
    {
      id: "k-pyongyang",
      unitId: "korea-ancient",
      placeId: "pyongyang",
      title: "장수왕의 평양 천도",
      period: "427년",
      summary:
        "장수왕은 수도를 국내성에서 평양으로 옮겨 왕권을 강화하고 남쪽으로 세력을 넓혔다.",
      significance:
        "대동강 유역의 평야와 바다로 이어지는 교통은 새 수도의 중요한 이점이었다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 25,
          printedPage: "27",
        },
      ],
      relatedPlaceIds: ["gongju"],
    },
    {
      id: "k-gongju",
      unitId: "korea-ancient",
      placeId: "gongju",
      displayName: "웅진",
      nameNote: "웅진은 오늘날 공주 지역에 있던 백제의 수도이다.",
      title: "위기 속에 옮긴 백제의 수도",
      period: "475년 이후",
      summary:
        "한성을 잃은 백제는 웅진으로 수도를 옮긴 뒤 나라를 다시 안정시키려 하였다.",
      significance:
        "무령왕은 지방 통제를 강화하고 중국 남조와 교류하며 중흥의 기반을 마련하였다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 27,
          printedPage: "29",
        },
      ],
      relatedPlaceIds: ["pyongyang", "buyeo"],
    },
    {
      id: "k-buyeo",
      unitId: "korea-ancient",
      placeId: "buyeo",
      displayName: "사비",
      nameNote:
        "사비는 오늘날 충남 부여 지역의 옛 이름이다. 고대 국가 부여와 구분한다.",
      title: "사비에서 추진한 백제의 재정비",
      period: "538년 이후",
      summary:
        "성왕은 넓은 평야와 강을 이용하기 좋은 사비로 수도를 옮기고 통치 조직을 다시 정비하였다.",
      significance:
        "중국 남조와 교류하고 왜에 불교와 문물을 전하면서 대외 활동도 이어 갔다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 28,
          printedPage: "30",
        },
      ],
      relatedPlaceIds: ["gongju"],
    },
    {
      id: "k-gimhae",
      unitId: "korea-ancient",
      placeId: "gimhae",
      title: "철과 바닷길로 성장한 금관가야",
      period: "가야 시대",
      summary:
        "김해의 금관가야는 낙동강 하류의 철 생산과 해상 교통을 바탕으로 초기 가야 연맹을 이끌었다.",
      significance:
        "낙랑과 왜 등과의 교류는 철기 문화의 성장과 연결되어 있었다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 31,
          printedPage: "33",
        },
      ],
      relatedPlaceIds: ["gyeongju"],
    },
    {
      id: "k-gyeongju",
      unitId: "korea-north-south",
      placeId: "gyeongju",
      displayName: "금성(경주)",
      nameNote: "여기서 금성은 신라의 수도인 경주를 가리킨다.",
      title: "통일 신라의 수도와 지방 운영",
      period: "7~8세기",
      summary:
        "통일 신라는 금성을 수도로 삼고 전국을 9주와 5소경으로 정비하였다.",
      significance:
        "5소경은 수도가 동남쪽에 치우친 점을 보완하며 넓어진 나라를 다스리는 역할을 하였다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 56,
          printedPage: "58",
        },
      ],
      relatedPlaceIds: ["sanggyeong", "ulsan"],
    },
    {
      id: "k-sanggyeong",
      unitId: "korea-north-south",
      placeId: "sanggyeong",
      title: "발해의 수도 상경",
      period: "8~9세기",
      summary:
        "문왕은 수도를 상경으로 옮기고 통치 제도를 정비하면서 당과의 관계를 개선하였다.",
      significance:
        "발해는 주변 나라와 교류하며 성장했고 선왕 때 해동성국이라 불릴 만큼 발전하였다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 57,
          printedPage: "59",
        },
      ],
      relatedPlaceIds: ["gyeongju", "xian"],
    },
    {
      id: "k-wando",
      unitId: "korea-north-south",
      placeId: "wando",
      title: "장보고의 해상 교역 거점",
      period: "9세기",
      summary:
        "장보고는 완도에 청해진을 설치하여 해적을 소탕하고 바닷길을 확보하였다.",
      significance:
        "청해진을 중심으로 신라·당·일본을 잇는 해상 무역이 활발하게 이루어졌다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 68,
          printedPage: "70",
        },
      ],
      relatedPlaceIds: ["ulsan", "gyeongju"],
    },
    {
      id: "k-ulsan",
      unitId: "korea-north-south",
      placeId: "ulsan",
      title: "먼 지역의 상인이 찾은 항구",
      period: "통일 신라 시대",
      summary: "수도 금성과 가까운 울산항은 통일 신라의 무역항으로 번성하였다.",
      significance:
        "아라비아 상인도 왕래하면서 신라의 이름과 문물이 이슬람 세계에 알려졌다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 68,
          printedPage: "70",
        },
      ],
      relatedPlaceIds: ["gyeongju", "wando", "baghdad"],
      relatedEntryIds: ["kr-entry-10a66d5a6536"],
    },
    {
      id: "k-kaesong",
      unitId: "korea-goryeo",
      placeId: "kaesong",
      displayName: "송악(개성)",
      title: "송악에서 시작된 고려의 통합",
      period: "918~936년",
      summary:
        "왕건은 고려를 세운 이듬해 송악으로 수도를 옮기고 후삼국을 통일하였다.",
      significance:
        "신라와 후백제뿐 아니라 발해 유민도 받아들이며 여러 세력을 새로운 나라에 통합하였다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 75,
          printedPage: "77",
        },
      ],
      relatedPlaceIds: ["gyeongju", "ganghwa"],
    },
    {
      id: "k-ganghwa",
      unitId: "korea-goryeo",
      placeId: "ganghwa",
      title: "몽골 침입에 맞선 강화 천도",
      period: "1232년",
      summary:
        "고려 조정은 몽골의 침입에 맞서 수도를 개경에서 강화도로 옮겼다.",
      significance:
        "농사지을 땅과 거센 물살은 방어에 유리했지만 본토의 백성들은 오랜 전쟁을 겪어야 했다.",
      citations: [
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
      relatedPlaceIds: ["kaesong", "jeju"],
    },
    {
      id: "k-jeju",
      unitId: "korea-goryeo",
      placeId: "jeju",
      title: "삼별초의 마지막 항쟁",
      period: "13세기 후반",
      summary:
        "개경 환도에 반대한 삼별초는 진도에 이어 제주도로 옮겨 항쟁을 계속하였다.",
      significance:
        "고려와 몽골 연합군의 진압은 오랫동안 이어진 대몽 항쟁의 한 국면을 마무리하였다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 92,
          printedPage: "94",
        },
      ],
      relatedPlaceIds: ["ganghwa"],
    },
    {
      id: "k-cheongju",
      unitId: "korea-goryeo",
      placeId: "cheongju",
      title: "직지와 금속 활자 인쇄",
      period: "1377년",
      summary: "청주 흥덕사에서는 금속 활자로 불교 서적인 직지를 인쇄하였다.",
      significance:
        "현재 남아 있는 가장 오래된 금속 활자 인쇄본은 고려 인쇄 기술의 높은 수준을 보여 준다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 106,
          printedPage: "108",
        },
      ],
    },
    {
      id: "k-seoul",
      unitId: "korea-joseon",
      placeId: "seoul",
      title: "조선의 새 수도 한양",
      period: "1394년",
      summary: "조선은 건국 뒤 교통과 방어에 유리한 한양으로 수도를 옮겼다.",
      significance:
        "한강을 이용한 수운과 주변 산지는 새 왕조의 중심 도시를 운영하는 중요한 조건이었다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 113,
          printedPage: "115",
        },
      ],
      relatedPlaceIds: ["kaesong", "suwon"],
    },
    {
      id: "k-andong",
      unitId: "korea-joseon",
      placeId: "andong",
      title: "서원에 남은 사림의 학문과 교육",
      period: "조선 시대",
      summary:
        "안동의 병산 서원은 유성룡과 그의 학문을 기리기 위해 세워진 서원이다.",
      significance:
        "사당과 강당, 기숙사 배치는 선현을 모시는 일과 학문 교육이 함께 이루어졌음을 보여 준다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 125,
          printedPage: "127",
        },
      ],
    },
    {
      id: "k-hansando",
      unitId: "korea-joseon",
      placeId: "hansando",
      title: "보급로를 지킨 조선 수군",
      period: "1592년",
      summary:
        "이순신이 이끈 수군은 한산도 등 여러 해전에서 일본군을 무찔렀다.",
      significance:
        "수군의 승리는 서남해의 바닷길과 곡창 지대를 지키고 일본군의 해상 보급을 막는 데 기여하였다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 133,
          printedPage: "135",
        },
      ],
      relatedPlaceIds: ["busan"],
    },
    {
      id: "k-namhansanseong",
      unitId: "korea-joseon",
      placeId: "namhansanseong",
      title: "병자호란과 화의의 선택",
      period: "1636년 발발한 병자호란",
      summary:
        "남한산성에 포위된 조선 조정은 청에 맞설 것인지 화의를 맺을 것인지 논쟁하였다.",
      significance:
        "구원병의 패배와 강화도 함락 뒤 인조는 삼전도에서 항복했고 많은 사람이 청으로 끌려갔다.",
      citations: [
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
      relatedPlaceIds: ["seoul", "ganghwa"],
    },
    {
      id: "k-suwon",
      unitId: "korea-late-joseon",
      placeId: "suwon",
      title: "정조가 구상한 계획도시",
      period: "18세기 후반",
      summary:
        "정조는 수원 화성을 정치·군사·경제 기능을 갖춘 도시로 키우려 하였다.",
      significance:
        "성곽과 시장, 축조에 쓰인 기구는 도시 계획과 당시 과학 기술을 함께 보여 준다.",
      citations: [
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
      relatedPlaceIds: ["seoul"],
    },
    {
      id: "k-jinju",
      unitId: "korea-late-joseon",
      placeId: "jinju",
      title: "수탈에 맞선 진주 농민 봉기",
      period: "1862년",
      summary: "진주의 농민들은 관리의 과도한 수탈에 맞서 봉기하였다.",
      significance:
        "저항이 여러 지역으로 퍼져 임술 농민 봉기로 이어지자 정부는 삼정의 폐단을 바로잡으려 하였다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 152,
          printedPage: "154",
        },
      ],
    },
    {
      id: "k-busan",
      unitId: "korea-late-joseon",
      placeId: "busan",
      title: "조선 통신사가 오간 바닷길",
      period: "17~19세기",
      summary: "부산은 조선 통신사가 일본으로 건너가는 길목에 자리하였다.",
      significance:
        "사절단은 외교 업무를 수행하면서 일본인들과 글과 학문, 문물을 교류하였다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 155,
          printedPage: "157",
        },
      ],
      relatedPlaceIds: ["seoul", "tokyo"],
    },
    {
      id: "k-jeonju",
      unitId: "korea-modern",
      placeId: "jeonju",
      title: "전주 화약과 동학 농민군의 개혁",
      period: "1894년",
      summary: "전주성을 점령한 동학 농민군은 정부와 전주 화약을 맺었다.",
      significance:
        "농민군은 전라도 각지에 집강소를 두고 부당한 수탈을 줄이는 개혁을 추진하였다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 174,
          printedPage: "176",
        },
      ],
      relatedPlaceIds: ["gongju"],
    },
    {
      id: "k-daegu",
      unitId: "korea-modern",
      placeId: "daegu",
      title: "국민의 모금으로 국채를 갚으려 하다",
      period: "1907년",
      summary:
        "대구에서 시작된 국채 보상 운동은 일본에 진 빚을 갚으려는 모금 운동이었다.",
      significance:
        "외세의 경제 침탈에 대응하려는 움직임이 여러 지역의 시민 참여로 확산되었다.",
      citations: [
        {
          sourceId: "atlas-lee",
          pdfPage: 104,
          printedPage: "106",
        },
      ],
    },
    {
      id: "k-shanghai",
      unitId: "korea-modern",
      placeId: "shanghai",
      title: "대한민국 임시 정부의 활동",
      period: "1919년 이후",
      summary: "3·1 운동을 계기로 상하이에 대한민국 임시 정부가 수립되었다.",
      significance:
        "임시 정부는 국내 연락망과 독립신문, 자금 모집 및 외교 활동을 통해 독립운동을 이어 갔다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 180,
          printedPage: "182",
        },
      ],
      relatedPlaceIds: ["chongqing", "seoul"],
    },
    {
      id: "k-chongqing",
      unitId: "korea-modern",
      placeId: "chongqing",
      title: "한국 광복군을 창설하다",
      period: "1940년",
      summary:
        "여러 지역을 옮겨 다니던 대한민국 임시 정부는 충칭에 정착하여 한국 광복군을 창설하였다.",
      significance:
        "태평양 전쟁 뒤에는 연합군의 일원으로 항일 전쟁에 참여하고 국내 진입 작전을 준비하였다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 181,
          printedPage: "183",
        },
      ],
      relatedPlaceIds: ["shanghai"],
    },
    {
      id: "k-gwangju",
      unitId: "korea-modern",
      placeId: "gwangju",
      title: "민주주의 회복을 요구한 시민들",
      period: "1980년 5월",
      summary:
        "광주의 시민들은 계엄 철회와 민주주의 회복을 요구하며 신군부에 맞섰다.",
      significance:
        "계엄군의 무력 진압으로 많은 사람이 희생된 5·18 민주화 운동은 한국 민주주의의 중요한 역사로 남았다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 198,
          printedPage: "200",
        },
      ],
    },
    {
      id: "k-incheon",
      unitId: "korea-modern",
      placeId: "incheon",
      title: "6·25 전쟁의 전환점",
      period: "1950년",
      summary:
        "국군과 유엔군은 인천 상륙 작전에 성공한 뒤 서울을 되찾고 북쪽으로 진격하였다.",
      significance:
        "이후 중국군의 참전과 후퇴, 정전 협상을 거치며 전쟁은 한반도에 큰 피해와 분단의 상처를 남겼다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 204,
          printedPage: "206",
        },
      ],
      relatedPlaceIds: ["seoul", "panmunjom"],
    },
    {
      id: "k-panmunjom",
      unitId: "korea-modern",
      placeId: "panmunjom",
      title: "남북 정상의 만남과 평화 노력",
      period: "2018년",
      summary: "남북한 정상은 판문점에서 회담을 열고 판문점 선언을 발표하였다.",
      significance:
        "교과서는 이 만남을 변화하는 남북 관계 속에서 대화와 협력으로 평화를 모색한 사례로 다룬다.",
      citations: [
        {
          sourceId: "history2-lee",
          pdfPage: 207,
          printedPage: "209",
        },
      ],
      relatedPlaceIds: ["incheon"],
    },
    {
      id: "w-ur",
      unitId: "world-ancient",
      placeId: "ur",
      title: "신전을 중심으로 성장한 도시",
      period: "기원전 3500년경 이후",
      summary:
        "우르는 수메르인이 메소포타미아에 세운 도시 국가 가운데 하나였다.",
      significance:
        "도시의 지구라트는 종교와 정치가 긴밀하게 연결된 초기 문명의 모습을 보여 준다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 20,
          printedPage: "22",
        },
      ],
      relatedPlaceIds: ["mohenjo-daro"],
    },
    {
      id: "w-giza",
      unitId: "world-ancient",
      placeId: "giza",
      title: "피라미드에 담긴 왕권과 내세관",
      period: "고대 이집트",
      summary:
        "기자 지역의 피라미드는 파라오의 강한 권력과 죽은 뒤의 세계에 대한 믿음을 보여 주는 유적이다.",
      significance:
        "피라미드와 스핑크스, 미라는 이집트인의 내세관이 건축과 생활에 남긴 흔적이다.",
      citations: [
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
      relatedPlaceIds: ["ur"],
    },
    {
      id: "w-mohenjo",
      unitId: "world-ancient",
      placeId: "mohenjo-daro",
      title: "공공시설을 갖춘 인더스의 도시",
      period: "기원전 2500년경 이후",
      summary:
        "모헨조다로는 주택과 배수 시설, 목욕탕과 곡물 창고를 갖춘 계획도시였다.",
      significance:
        "도시 구조와 유물은 인더스 문명의 조직적인 생활과 다른 지역과의 교류를 보여 준다.",
      citations: [
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
      relatedPlaceIds: ["ur"],
    },
    {
      id: "w-athens",
      unitId: "world-ancient",
      placeId: "athens",
      title: "시민의 참여로 발전한 민주 정치",
      period: "기원전 5세기",
      summary:
        "아테네에서는 시민의 정치 참여가 확대되며 민회를 중심으로 한 직접 민주 정치가 발전하였다.",
      significance:
        "다만 여성과 노예, 외국인은 참여에서 제외되어 오늘날의 민주주의와는 차이가 있었다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 35,
          printedPage: "37",
        },
        {
          sourceId: "history1",
          pdfPage: 36,
          printedPage: "38",
        },
        {
          sourceId: "atlas-2022",
          pdfPage: 17,
          printedPage: "17~18",
        },
      ],
      relatedPlaceIds: ["rome"],
    },
    {
      id: "w-rome",
      unitId: "world-ancient",
      placeId: "rome",
      title: "공화정과 지중해 세계의 확대",
      period: "기원전 6~2세기",
      summary:
        "로마에서는 공화정 아래 귀족과 평민의 정치적 경쟁이 이어지며 평민회와 호민관이 등장하였다.",
      significance:
        "지중해로 영토가 넓어지는 과정은 부의 집중과 자영 농민의 몰락이라는 갈등도 가져왔다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 39,
          printedPage: "41",
        },
      ],
      relatedPlaceIds: ["athens"],
    },
    {
      id: "w-xian",
      unitId: "world-religions",
      placeId: "xian",
      title: "사람과 종교가 모인 당의 수도",
      period: "7~8세기",
      summary:
        "당의 수도 장안에는 여러 나라의 사신과 유학생, 승려가 모여들었다.",
      significance:
        "비단길과 바닷길을 통한 교류는 다양한 종교와 예술이 공존하는 국제적인 문화를 만들었다.",
      citations: [
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
      relatedPlaceIds: ["nara", "sanggyeong"],
    },
    {
      id: "w-nara",
      unitId: "world-religions",
      placeId: "nara",
      displayName: "헤이조쿄(나라)",
      nameNote:
        "헤이조쿄는 나라 시대의 수도명이다. 이후 옮긴 헤이안쿄는 교토 지역으로 서로 다른 장소이다.",
      title: "동아시아 문화를 받아들인 수도",
      period: "8세기",
      summary:
        "일본은 당의 장안성을 본뜬 헤이조쿄로 수도를 옮겨 나라 시대를 열었다.",
      significance:
        "도다이사 같은 큰 사찰의 건립은 국가 운영과 불교문화가 밀접하게 연결되었음을 보여 준다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 63,
          printedPage: "65",
        },
      ],
      relatedPlaceIds: ["xian"],
    },
    {
      id: "w-mecca",
      unitId: "world-religions",
      placeId: "mecca",
      title: "교역 도시에서 시작된 이슬람교",
      period: "7세기",
      summary:
        "메카는 아라비아 교역로의 중심지 가운데 하나였으며 무함마드가 이슬람교를 전한 곳이다.",
      significance:
        "무함마드는 메디나로 이주한 뒤 세력을 키워 메카를 장악하고 아라비아의 여러 지역을 통합하였다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 67,
          printedPage: "69",
        },
      ],
      relatedPlaceIds: ["baghdad"],
    },
    {
      id: "w-baghdad",
      unitId: "world-religions",
      placeId: "baghdad",
      title: "아바스 왕조의 국제도시",
      period: "8~13세기",
      summary:
        "아바스 왕조의 수도 바그다드는 여러 지역의 사람과 물산이 모이는 국제도시로 성장하였다.",
      significance:
        "동서 교역과 다양한 문화의 만남은 이슬람 세계의 학문과 경제 발전을 뒷받침하였다.",
      citations: [
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
      relatedPlaceIds: ["mecca", "istanbul", "ulsan"],
    },
    {
      id: "w-constantinople",
      unitId: "world-religions",
      placeId: "istanbul",
      displayName: "콘스탄티노폴리스",
      nameNote:
        "비잔티움 제국의 수도를 가리키는 이름이다. 같은 도시의 오스만 시대 설명은 이스탄불에서 볼 수 있다.",
      relatedEntryIds: ["w-istanbul"],
      title: "유럽과 아시아를 잇는 비잔티움의 수도",
      period: "6세기 중심",
      summary:
        "비잔티움 제국의 수도 콘스탄티노폴리스는 육지와 바닷길이 만나는 교역의 중심지였다.",
      significance:
        "황제의 통치와 크리스트교 문화가 결합한 도시는 오랫동안 제국의 정치·경제적 기반이 되었다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 80,
          printedPage: "82",
        },
      ],
      relatedPlaceIds: ["rome", "baghdad"],
    },
    {
      id: "w-kaifeng",
      unitId: "world-exchange",
      placeId: "kaifeng",
      title: "상업과 서민 문화가 성장한 도시",
      period: "송 시대",
      summary:
        "카이펑에서는 상업의 성장과 함께 도시 생활이 활발해지고 다양한 공연이 인기를 얻었다.",
      significance:
        "화폐 유통과 전문 공연장은 경제 발전이 사람들의 일상과 문화까지 바꾸었음을 보여 준다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 94,
          printedPage: "96",
        },
      ],
    },
    {
      id: "w-karakorum",
      unitId: "world-exchange",
      placeId: "karakorum",
      title: "몽골 제국의 교통망",
      period: "13~14세기",
      summary:
        "카라코룸은 몽골 제국의 여러 지역을 연결하는 교통망에 놓여 있었다.",
      significance:
        "길과 역참을 통한 사람과 물자의 이동은 유라시아의 동서 교류를 확대하였다.",
      citations: [
        {
          sourceId: "atlas-2022",
          pdfPage: 31,
          printedPage: "33",
        },
      ],
      relatedPlaceIds: ["beijing", "baghdad"],
    },
    {
      id: "w-beijing",
      unitId: "world-exchange",
      placeId: "beijing",
      title: "명이 새 수도로 삼은 베이징",
      period: "15세기",
      summary:
        "명의 영락제는 수도를 베이징으로 옮기고 적극적인 대외 정책을 추진하였다.",
      significance:
        "몽골 원정과 정화의 항해는 새 수도를 중심으로 국력을 드러내려 한 활동이었다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 101,
          printedPage: "103",
        },
      ],
      relatedPlaceIds: ["xian", "karakorum"],
    },
    {
      id: "w-istanbul",
      unitId: "world-exchange",
      placeId: "istanbul",
      displayName: "이스탄불",
      nameNote:
        "교과서는 오스만 제국의 정복 뒤 이 도시가 이스탄불로 불렸다고 설명한다. 비잔티움 시대에는 콘스탄티노폴리스가 수도명이었다.",
      relatedEntryIds: ["w-constantinople"],
      title: "오스만 제국의 수도가 되다",
      period: "1453년 이후",
      summary:
        "오스만 제국은 콘스탄티노폴리스를 점령하여 비잔티움 제국을 무너뜨리고 수도로 삼았다.",
      significance:
        "이 도시는 오스만 제국이 유럽과 아시아, 아프리카로 영향력을 넓히는 중심지가 되었다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 111,
          printedPage: "113",
        },
      ],
      relatedPlaceIds: ["baghdad", "rome"],
    },
    {
      id: "w-agra",
      unitId: "world-exchange",
      placeId: "agra",
      title: "두 문화가 만난 타지마할",
      period: "무굴 제국 시대",
      summary:
        "아그라의 타지마할은 무굴 황제 샤자한이 황후를 기리기 위해 세운 건축물이다.",
      significance:
        "연꽃 장식과 돔, 아치의 결합은 인도 고유의 문화와 이슬람 문화가 어우러진 모습을 보여 준다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 115,
          printedPage: "117",
        },
      ],
    },
    {
      id: "w-lisbon",
      unitId: "world-exchange",
      placeId: "lisbon",
      title: "인도로 향한 포르투갈의 바닷길",
      period: "15~16세기",
      summary:
        "리스본은 포르투갈이 아프리카를 돌아 인도로 나아간 항해로의 출발점으로 지도에 나타난다.",
      significance:
        "항해 기술의 발달과 동방 물품을 직접 거래하려는 움직임이 새로운 바닷길 개척을 이끌었다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 117,
          printedPage: "119",
        },
      ],
      relatedPlaceIds: ["agra"],
    },
    {
      id: "w-boston",
      unitId: "world-nations",
      placeId: "boston",
      title: "과세에 대한 저항과 보스턴 차 사건",
      period: "1773년",
      summary:
        "보스턴에서는 영국의 과세에 반발하는 식민지인들의 보스턴 차 사건이 일어났다.",
      significance:
        "영국의 항구 봉쇄와 식민지의 저항은 독립 전쟁으로 이어지는 갈등을 키웠다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 132,
          printedPage: "134",
        },
      ],
      relatedPlaceIds: ["philadelphia"],
    },
    {
      id: "w-philadelphia",
      unitId: "world-nations",
      placeId: "philadelphia",
      title: "미국 독립 선언의 무대",
      period: "1776년",
      summary: "필라델피아에서 식민지 대표들은 독립을 선언하였다.",
      significance:
        "자유와 권리, 국민의 동의를 강조한 선언은 새로운 공화국을 세우는 원칙을 제시하였다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 132,
          printedPage: "134",
        },
      ],
      relatedPlaceIds: ["boston", "paris"],
    },
    {
      id: "w-paris",
      unitId: "world-nations",
      placeId: "paris",
      title: "구제도에 맞선 프랑스 혁명",
      period: "1789년",
      summary:
        "파리 시민들의 바스티유 감옥 습격은 불평등한 신분제와 왕권에 대한 저항을 보여 주었다.",
      significance:
        "혁명 과정에서 발표된 인권 선언은 자유와 평등을 새로운 정치 질서의 원칙으로 내세웠다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 134,
          printedPage: "136",
        },
      ],
      relatedPlaceIds: ["philadelphia", "versailles"],
    },
    {
      id: "w-manchester",
      unitId: "world-nations",
      placeId: "manchester",
      title: "공장과 산업 도시의 성장",
      period: "19세기",
      summary: "맨체스터는 산업화와 함께 인구가 크게 늘어난 영국의 도시였다.",
      significance:
        "대규모 공장과 임금 노동의 확대는 농업 중심 사회가 산업 사회로 바뀌는 흐름을 보여 준다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 146,
          printedPage: "148",
        },
      ],
    },
    {
      id: "w-wuchang",
      unitId: "world-nations",
      placeId: "wuchang",
      title: "신해혁명의 불씨가 되다",
      period: "1911년",
      summary:
        "우창에서 신식 군대가 봉기하자 여러 지역이 호응하며 청으로부터 독립을 선언하였다.",
      significance:
        "이 움직임은 중화민국 수립으로 이어졌지만 이후에도 정치적 갈등과 군벌의 성장은 계속되었다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 166,
          printedPage: "168",
        },
      ],
      relatedPlaceIds: ["beijing", "tokyo"],
    },
    {
      id: "w-tokyo",
      unitId: "world-nations",
      placeId: "tokyo",
      displayName: "도쿄",
      title: "메이지 유신과 도시의 변화",
      period: "1868년 이후",
      summary:
        "메이지 정부는 중앙 집권 체제를 강화하고 교육과 산업 등 여러 분야의 개혁을 추진하였다.",
      significance:
        "도쿄의 가스등과 벽돌 건물, 마차는 서구 문물의 수용이 도시 생활을 바꾼 모습을 보여 준다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 167,
          printedPage: "169",
        },
      ],
      relatedPlaceIds: ["wuchang", "busan"],
    },
    {
      id: "w-sarajevo",
      unitId: "world-wars",
      placeId: "sarajevo",
      title: "세계 대전으로 번진 지역의 충돌",
      period: "1914년",
      summary:
        "사라예보에서 오스트리아·헝가리 제국의 황태자 부부가 암살되었다.",
      significance:
        "이 사건은 발칸의 민족 갈등과 열강의 동맹 대립 속에서 제1차 세계 대전이 시작되는 계기가 되었다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 177,
          printedPage: "179",
        },
      ],
      relatedPlaceIds: ["versailles"],
    },
    {
      id: "w-versailles",
      unitId: "world-wars",
      placeId: "versailles",
      title: "전후 질서와 베르사유 조약",
      period: "1919년",
      summary: "제1차 세계 대전 뒤 연합국과 독일은 베르사유 조약을 맺었다.",
      significance:
        "독일에 전쟁 책임과 배상 부담을 지운 조약은 전후 국제 질서의 성격과 한계를 보여 준다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 181,
          printedPage: "183",
        },
      ],
      relatedPlaceIds: ["sarajevo", "paris"],
    },
    {
      id: "w-nanjing",
      unitId: "world-wars",
      placeId: "nanjing",
      title: "전쟁 중 벌어진 대량 학살",
      period: "1937년",
      summary:
        "중일 전쟁 중 난징을 점령한 일본군은 포로와 민간인들을 학살하였다.",
      significance:
        "이 사건은 전쟁이 사람들의 생명과 기본적 권리를 어떻게 파괴하는지 보여 준다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 195,
          printedPage: "197",
        },
      ],
      relatedPlaceIds: ["hiroshima"],
    },
    {
      id: "w-hiroshima",
      unitId: "world-wars",
      placeId: "hiroshima",
      title: "원자 폭탄과 전쟁의 피해",
      period: "1945년",
      summary:
        "히로시마에는 제2차 세계 대전 중 원자 폭탄이 투하되어 많은 사람이 희생되었다.",
      significance:
        "도시의 피해는 대량 살상 무기와 민간인의 고통을 함께 살피며 평화의 의미를 생각하게 한다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 195,
          printedPage: "197",
        },
      ],
      relatedPlaceIds: ["nanjing"],
    },
    {
      id: "w-bandung",
      unitId: "world-contemporary",
      placeId: "bandung",
      title: "아시아·아프리카의 협력 선언",
      period: "1955년",
      summary:
        "반둥에서는 아시아와 아프리카 29개국 대표가 모여 평화 10원칙을 발표하였다.",
      significance:
        "제국주의에 반대하고 협력을 강조한 회의는 냉전의 두 진영 밖에서 제3 세계가 목소리를 내는 계기가 되었다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 212,
          printedPage: "214",
        },
      ],
    },
    {
      id: "w-berlin",
      unitId: "world-contemporary",
      placeId: "berlin",
      title: "장벽 붕괴와 독일 통일",
      period: "1989~1990년",
      summary: "1989년 베를린 장벽이 무너지고 이듬해 독일이 통일되었다.",
      significance:
        "이는 동유럽의 변화와 함께 냉전 체제가 해체되는 과정을 상징하는 사건이다.",
      citations: [
        {
          sourceId: "history1",
          pdfPage: 215,
          printedPage: "217",
        },
      ],
      relatedPlaceIds: ["bandung"],
    },
  ],
};

const places = new Map<string, AtlasPlace>();
for (const place of [
  ...originalHistoryAtlasDataset.places,
  ...koreaExpansionPlaces,
  ...worldExpansionPlaces,
]) {
  if (places.has(place.id))
    throw new Error(`Duplicate atlas place: ${place.id}`);
  places.set(place.id, place);
}
for (const update of [...koreaPlaceUpdates, ...worldPlaceUpdates]) {
  const current = places.get(update.id);
  if (!current) throw new Error(`Unknown atlas place update: ${update.id}`);
  places.set(update.id, {
    ...current,
    ...update,
    aliases: [
      ...new Set([...(current.aliases || []), ...(update.aliases || [])]),
    ],
  });
}

export const historyAtlasDataset: AtlasDataset = addAtlasHistoricalStories(
  {
    ...originalHistoryAtlasDataset,
    places: [...places.values()],
    eras: historyAtlasEras,
    entries: [
      ...originalHistoryAtlasDataset.entries.map((entry) => ({
        ...entry,
        eraIds: originalAtlasEntryEras[entry.id] || [],
      })),
      ...koreaExpansionEntries.map((entry) => ({
        ...entry,
        ...koreaHistoricalEntryCorrections[entry.id],
      })),
      ...worldExpansionEntries.map((entry) => ({
        ...entry,
        ...worldHistoricalEntryCorrections[entry.id],
      })),
    ],
  },
  [
    ...koreaHistoricalStories,
    ...worldHistoricalStories,
    ...profileHistoricalStories,
  ],
);
