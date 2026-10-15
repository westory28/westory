import type { AtlasPlace } from "../lib/historyAtlas";
import type { AtlasHistoricalStory } from "../lib/historyAtlasStories";

/** Verified supplements to the source ledger. Original textbook places and
 * captions remain unchanged; the map view applies these location overrides.
 * A registered point locates a monument, not an ancient territorial boundary.
 */
export const atlasKoreaRestoredPlaceOverrides: Record<
  string,
  Partial<AtlasPlace>
> = {
  "kr-42182b7d5100": {
    coordinates: [128.875536, 35.243547],
    kind: "site",
    modernName: "경남 김해시 구산동 산81-2번지 일원",
    locationNote:
      "국가유산청이 공개한 김해 구지봉의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-41355b2ef6ea": {
    coordinates: [128.878421, 35.235255],
    kind: "site",
    modernName: "경상남도 김해시 왕릉길 26(서상동, 김수로왕릉)",
    locationNote:
      "국가유산청이 공개한 김해 수로왕릉의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-43c62744a4f4": {
    coordinates: [129.223004, 35.831801],
    kind: "site",
    modernName: "경북 경주시 인왕동 387-1번지",
    locationNote:
      "국가유산청이 공개한 경주 월성의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-77b320dc1ed4": {
    coordinates: [127.8485, 37.028087],
    kind: "site",
    modernName: "충청북도 충주시 감노로 2319 (중앙탑면, 충주고구려비전시관)",
    locationNote:
      "국가유산청이 공개한 충주 고구려비의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-fb038027b398": {
    coordinates: [128.321793, 36.945118],
    kind: "site",
    modernName: "충북 단양군 단성면 하방리 산3-1번지",
    locationNote:
      "국가유산청이 공개한 단양 적성의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-20b36ef183a5": {
    coordinates: [127.115878, 37.533939],
    kind: "site",
    modernName: "서울 송파구 풍납1동 72-1번지 외",
    locationNote:
      "국가유산청이 공개한 서울 풍납동 토성의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-49b31c53bf7a": {
    coordinates: [127.12652, 36.463881],
    kind: "site",
    modernName: "충남 공주시 산성동 2번지",
    locationNote:
      "국가유산청이 공개한 공주 공산성의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-ef0b3d79916d": {
    coordinates: [127.188222, 37.522392],
    kind: "site",
    modernName: "경기 하남시 춘궁동 산36번지 외",
    locationNote:
      "국가유산청이 공개한 하남 이성산성의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-a76f02643cdd": {
    coordinates: [128.258259, 35.721625],
    kind: "site",
    modernName: "경북 고령군 고령읍 지산리 산8번지",
    locationNote:
      "국가유산청이 공개한 고령 지산동 고분군의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-cc53fabf10ab": {
    coordinates: [126.60523, 36.773806],
    kind: "site",
    modernName:
      "충남 서산시 운산면 용현리 2-10번지 / (도로명)운산면 마애삼존불로 65-13",
    locationNote:
      "국가유산청이 공개한 서산 용현리 마애여래삼존상의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-74eb96d6661b": {
    coordinates: [127.742316, 36.48857],
    kind: "site",
    modernName: "충북 보은군 보은읍 성주1길 104 (어암리)",
    locationNote:
      "국가유산청이 공개한 보은 삼년산성의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-84e61b3eab9a": {
    coordinates: [129.188548, 35.825134],
    kind: "site",
    modernName: "경북 경주시 서악동 844-1번지 / (도로명)경주시 대경로 4859",
    locationNote:
      "국가유산청이 공개한 경주 태종무열왕릉비의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-6f68810a2fb8": {
    coordinates: [128.096533, 35.79918],
    kind: "site",
    modernName: "경남 합천군 가야면 해인사길 85, 해인사 (치인리)",
    locationNote:
      "국가유산청이 공개한 합천 해인사 길상탑의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-6bae6070884f": {
    coordinates: [129.226486, 35.834718],
    kind: "site",
    modernName: "경북 경주시 인왕동 517 번지 일대",
    locationNote:
      "국가유산청이 공개한 경주 동궁과 월지의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-507555e467bd": {
    coordinates: [129.332064, 35.790154],
    kind: "site",
    modernName: "경상북도 경주시 불국로 385(진현동, 불국사)",
    locationNote:
      "국가유산청이 공개한 경주 불국사 대웅전의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-c80fa65a1d43": {
    coordinates: [129.332268, 35.78997],
    kind: "site",
    modernName: "경북 경주시 불국로 385, 불국사 (진현동)",
    locationNote:
      "국가유산청이 공개한 경주 불국사 다보탑의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-699f2c61ea69": {
    coordinates: [129.331985, 35.789968],
    kind: "site",
    modernName: "경북 경주시 불국로 385, 불국사 (진현동)",
    locationNote:
      "국가유산청이 공개한 경주 불국사 삼층석탑의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-feb96c06aa14": {
    coordinates: [126.337605, 34.516306],
    kind: "site",
    modernName: "전남광주통합특별시 진도군 군내면 용장리 106번지",
    locationNote:
      "국가유산청이 공개한 진도 용장성의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-1ed4b496dccb": {
    coordinates: [126.487576, 37.631258],
    kind: "site",
    modernName: "인천 강화군 길상면 온수리 산41번지",
    locationNote:
      "국가유산청이 공개한 강화 삼랑성의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-6185d7d2721d": {
    coordinates: [128.09872, 35.801602],
    kind: "site",
    modernName: "경남 합천군 가야면 해인사길 122, 해인사 (치인리)",
    locationNote:
      "국가유산청이 공개한 합천 해인사 장경판전의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-b6bcc939acd8": {
    coordinates: [128.552605, 36.54058],
    kind: "site",
    modernName: "경상북도 안동시 병산길 386(풍천면, 병산서원)",
    locationNote:
      "국가유산청이 공개한 안동 병산서원의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-a38fd43eddde": {
    coordinates: [127.076659, 37.305785],
    kind: "site",
    modernName: "경기도 용인시 수지구 심곡로 16-9 (상현동)",
    locationNote:
      "국가유산청이 공개한 용인 심곡서원의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-442fb975dab0": {
    coordinates: [128.552719, 36.54041],
    kind: "site",
    modernName: "경상북도 안동시 병산길 386 (풍천면, 병산서원)",
    locationNote:
      "국가유산청이 공개한 안동 병산서원 만대루의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-c3b00a1be92c": {
    coordinates: [128.840297, 36.728037],
    kind: "site",
    modernName: "경북 안동시 도산면 도산서원길 154 (토계리)",
    locationNote:
      "국가유산청이 공개한 안동 도산서원의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-862bd72c7740": {
    coordinates: [128.580563, 36.925306],
    kind: "site",
    modernName: "경북 영주시 순흥면 내죽리 151번지",
    locationNote:
      "국가유산청이 공개한 영주 소수서원의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-33b188925aa0": {
    coordinates: [129.163367, 36.011767],
    kind: "site",
    modernName: "경북 경주시 안강읍 옥산서원길 216-27 (옥산리)",
    locationNote:
      "국가유산청이 공개한 경주 옥산서원의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-10bb079a880b": {
    coordinates: [127.783513, 35.548854],
    kind: "site",
    modernName: "경남 함양군 수동면 남계서원길 8-11, 일원 (원평리)",
    locationNote:
      "국가유산청이 공개한 함양 남계서원의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-333194fa9ac9": {
    coordinates: [126.751667, 35.310663],
    kind: "site",
    modernName: "전남광주통합특별시 장성군 필암서원로 184(황룡면)",
    locationNote:
      "국가유산청이 공개한 장성 필암서원의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-cd245446c0da": {
    coordinates: [127.180599, 36.209064],
    kind: "site",
    modernName: "충남 논산시 연산면 임리 74번지 외 5필지",
    locationNote:
      "국가유산청이 공개한 논산 돈암서원의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-93464ab4266a": {
    coordinates: [127.009659, 37.571131],
    kind: "site",
    modernName: "서울 종로구 종로 288 (종로6가) / (지번)서울 종로구 종로6가 69",
    locationNote:
      "국가유산청이 공개한 서울 흥인지문의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-6b7944097ae7": {
    coordinates: [127.101642, 37.510523],
    kind: "site",
    modernName: "서울특별시 송파구 잠실동 47",
    locationNote:
      "국가유산청의 삼전도비 등록 위치이다. 2010년 석촌호수 서호 주변으로 옮겨 보존하는 현재 위치이며, 1637년 항복 의식의 정확한 지점을 확정한 좌표는 아니다.",
  },
  "kr-ddd7324d743e": {
    coordinates: [127.013255, 37.281792],
    kind: "site",
    modernName: "경기 수원시 팔달구 장안동 1-2번지",
    locationNote:
      "국가유산청이 공개한 수원 화성의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-6a142297546f": {
    coordinates: [128.080128, 35.190354],
    kind: "site",
    modernName: "경상남도 진주시 남강로 626 (본성동, 진주성)",
    locationNote:
      "국가유산청이 공개한 진주성의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-08bd6fdf1ad4": {
    coordinates: [126.987308, 37.563251],
    kind: "site",
    modernName: "서울특별시 중구 명동길 74(명동2가, 명동성당)",
    locationNote:
      "국가유산청이 공개한 서울 명동성당의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-729119e6b9f6": {
    coordinates: [126.976953, 37.578342],
    kind: "site",
    modernName: "서울특별시 종로구 사직로 161 (세종로, 경복궁)",
    locationNote:
      "국가유산청이 공개한 경복궁 근정전의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-21cbecd852a8": {
    coordinates: [126.982594, 37.574424],
    kind: "site",
    modernName: "서울특별시 종로구 우정국로 59 (견지동, 우정총국)",
    locationNote:
      "국가유산청이 공개한 서울 우정총국의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-f408a789b2b0": {
    coordinates: [126.959456, 37.57254],
    kind: "site",
    modernName: "서울 서대문구 현저동 941번지",
    locationNote:
      "국가유산청의 독립문 등록 위치이다. 도로 공사로 1979년 옮겨 보존한 현재 위치이며, 처음 세운 자리와는 다르다.",
  },
  "kr-18b733ab896a": {
    coordinates: [126.976515, 37.564998],
    kind: "site",
    modernName: "서울 중구 세종대로 99 (정동)",
    locationNote:
      "국가유산청이 공개한 덕수궁의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-bcf851da163c": {
    coordinates: [126.853382, 35.754488],
    kind: "site",
    modernName: "전북 김제시 부량면 월승리 119번지",
    locationNote:
      "국가유산청이 공개한 김제 벽골제의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-a52af3e9391a": {
    coordinates: [129.233642, 35.840562],
    kind: "site",
    modernName: "경북 경주시 분황로 94-11, 분황사 (구황동)",
    locationNote:
      "국가유산청이 공개한 경주 분황사 모전석탑의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-667444e22c99": {
    coordinates: [129.191472, 35.845141],
    kind: "site",
    modernName: "경북 경주시 충효동 산7-1번지 림",
    locationNote:
      "국가유산청이 공개한 경주 김유신묘의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-c2fe1ffb423e": {
    coordinates: [129.484385, 35.73814],
    kind: "site",
    modernName: "경북 경주시 양북면 봉길리 앞 해중(대왕암)",
    locationNote:
      "국가유산청이 공개한 경주 문무대왕릉의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-6ae2d4695ab4": {
    coordinates: [128.014947, 35.086585],
    kind: "site",
    modernName: "경남 사천시 곤양면 흥사리 산48-2번지",
    locationNote:
      "국가유산청이 공개한 사천 흥사리 매향비의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-66c7b07aacdd": {
    coordinates: [128.687486, 36.998954],
    kind: "site",
    modernName: "경상북도 영주시 부석사로 345 (부석면, 부석사)",
    locationNote:
      "국가유산청이 공개한 영주 부석사 무량수전의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-254b01e6cf36": {
    coordinates: [128.843464, 36.727384],
    kind: "site",
    modernName: "경북 안동시 도산면 도산서원길 154 (토계리)",
    locationNote:
      "국가유산청이 공개한 안동 도산서원 전교당의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-ed8ad25e7791": {
    coordinates: [127.01481, 37.28184],
    kind: "site",
    modernName: "경기 수원시 팔달구 남창동 6-2번지",
    locationNote:
      "국가유산청이 공개한 수원 화성행궁의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-d18f7d3b24ac": {
    coordinates: [127.00955, 37.28582],
    kind: "site",
    modernName: "경기 수원시 팔달구 장안동 332번지",
    locationNote:
      "국가유산청이 공개한 수원 서북공심돈의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-2ad7f0aa1fec": {
    coordinates: [127.833098, 36.541942],
    kind: "site",
    modernName: "충북 보은군 속리산면 법주사로 379, 법주사 (사내리)",
    locationNote:
      "국가유산청이 공개한 보은 법주사 팔상전의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-50dba735c9cb": {
    coordinates: [126.979795, 37.564966],
    kind: "site",
    modernName: "서울 중구 소공동 87-14번지",
    locationNote:
      "국가유산청이 공개한 환구단의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-ef4605ebde38": {
    coordinates: [127.121697, 37.521197],
    kind: "site",
    modernName: "서울 송파구 방이2동 88-3번지",
    locationNote:
      "국가유산청이 공개한 서울 몽촌토성의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-55ca4e33a315": {
    coordinates: [127.05487, 35.97282],
    kind: "site",
    modernName: "전북 익산시 왕궁면 산80-1번지 외 ,금마면 동고도리 1109-8외",
    locationNote:
      "국가유산청이 공개한 익산 왕궁리 유적의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-6e8e468357ba": {
    coordinates: [126.915039, 36.278951],
    kind: "site",
    modernName: "충남 부여군 부여읍 동남리 254번지",
    locationNote:
      "국가유산청이 공개한 부여 정림사지의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-ab144d954c89": {
    coordinates: [129.218994, 35.834696],
    kind: "site",
    modernName: "경북 경주시 인왕동 839-1번지",
    locationNote:
      "국가유산청이 공개한 경주 첨성대의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-a5382a629d33": {
    coordinates: [127.030561, 36.012422],
    kind: "site",
    modernName: "전북 익산시 금마면 기양리 97번지",
    locationNote:
      "국가유산청이 공개한 익산 미륵사지 석탑의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-811a130012b1": {
    coordinates: [129.212833, 35.807241],
    kind: "site",
    modernName: "경북 경주시 배동 454-3번지",
    locationNote:
      "국가유산청이 공개한 경주 포석정지의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-9cac2157f1bd": {
    coordinates: [129.244012, 35.793126],
    kind: "site",
    modernName: "경북 경주시 남산동 227-3번지",
    locationNote:
      "국가유산청이 공개한 경주 남산동 동·서 삼층석탑의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-3a0fd059efbe": {
    coordinates: [129.235351, 35.771456],
    kind: "site",
    modernName: "경북 경주시 남산동 산36-4번지",
    locationNote:
      "국가유산청이 공개한 경주 남산 칠불암 마애불상군의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-dbef1a053624": {
    coordinates: [129.477007, 35.74814],
    kind: "site",
    modernName: "경북 경주시 양북면 용당리 55-3, 55-9번지",
    locationNote:
      "국가유산청이 공개한 경주 감은사지 동·서 삼층석탑의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-276508faea83": {
    coordinates: [129.223073, 35.780935],
    kind: "site",
    modernName: "경북 경주시 내남면 용장리 산1-1번지",
    locationNote:
      "국가유산청이 공개한 경주 남산 용장사곡 삼층석탑의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-dc2217fc4814": {
    coordinates: [127.489755, 36.633087],
    kind: "site",
    modernName: "충청북도 청주시 상당구 남문로2가 48-19",
    locationNote:
      "국가유산청이 공개한 청주 용두사지 철당간의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-b22fa37b3b12": {
    coordinates: [128.705249, 36.606555],
    kind: "site",
    modernName: "경북 안동시 이천동 산2번지",
    locationNote:
      "국가유산청이 공개한 안동 이천동 마애여래입상의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-d4c3c667b774": {
    coordinates: [128.59207, 37.731604],
    kind: "site",
    modernName: "강원 평창군 진부면 오대산로 374-8, 월정사 (동산리)",
    locationNote:
      "국가유산청이 공개한 평창 월정사 팔각 구층석탑의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-f86f6fabbb8e": {
    coordinates: [128.662442, 36.653444],
    kind: "site",
    modernName: "경북 안동시 서후면 봉정사길 222, 봉정사 (태장리)",
    locationNote:
      "국가유산청이 공개한 안동 봉정사 극락전의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-c4a88522c0dc": {
    coordinates: [126.622673, 36.663285],
    kind: "site",
    modernName: "충청남도 예산군 수덕사안길 79 (덕산면, 수덕사)",
    locationNote:
      "국가유산청이 공개한 예산 수덕사 대웅전의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-556d652da2f8": {
    coordinates: [126.99634, 37.578815],
    kind: "site",
    modernName: "서울특별시 종로구 창경궁로 185 (와룡동, 창경궁)",
    locationNote:
      "국가유산청이 공개한 창경궁의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-44484ff2c209": {
    coordinates: [126.975569, 37.579201],
    kind: "site",
    modernName: "서울특별시 종로구 사직로 161 (세종로, 경복궁)",
    locationNote:
      "국가유산청이 공개한 경복궁 경회루의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-8081f9dbac47": {
    coordinates: [126.824754, 37.599941],
    kind: "site",
    modernName: "경기 고양시 덕양구 행주내동 산26번지",
    locationNote:
      "국가유산청이 공개한 고양 행주산성의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-27c2834499ea": {
    coordinates: [127.016737, 37.277558],
    kind: "site",
    modernName: "경기 수원시 팔달구 팔달로2가 138번지",
    locationNote:
      "국가유산청이 공개한 수원 팔달문의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-dcd62974da10": {
    coordinates: [126.992737, 37.581925],
    kind: "site",
    modernName: "서울특별시 종로구 율곡로 99-0 (와룡동, 창덕궁)",
    locationNote:
      "국가유산청이 공개한 창덕궁 주합루의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-2261bcc0d80e": {
    coordinates: [126.971691, 37.568161],
    kind: "site",
    modernName: "서울 중구 정동길 21-18 (정동)",
    locationNote:
      "국가유산청이 공개한 서울 구 러시아공사관의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-296dbe381817": {
    coordinates: [126.913363, 36.279297],
    kind: "site",
    modernName: "충청남도 부여군 정림로 83 (부여읍, 정림사지) 정림사지박물관",
    locationNote:
      "국가유산청이 공개한 부여 정림사지 오층석탑의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-e7b46df31236": {
    coordinates: [129.211247, 35.801772],
    kind: "site",
    modernName: "경상북도 경주시 배동 산 65-1",
    locationNote:
      "국가유산청의 경주 배동 석조여래삼존입상 등록 위치이다. 주변에 흩어져 있던 불상들을 1923년 모아 세운 현재 보존 위치이다.",
  },
  "kr-6867c80f9a0f": {
    coordinates: [127.059222, 34.888294],
    kind: "site",
    modernName: "전남광주통합특별시 화순군 쌍산의로 459 (이양면, 쌍봉사)",
    locationNote:
      "국가유산청이 공개한 화순 쌍봉사 철감선사탑의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-b66ceee33052": {
    coordinates: [129.332158, 35.789723],
    kind: "site",
    modernName: "경북 경주시 불국로 385, 불국사 (진현동)",
    locationNote:
      "국가유산청이 공개한 경주 불국사 청운교 및 백운교의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-2b45a1718a45": {
    coordinates: [127.012116, 35.184194],
    kind: "site",
    modernName: "전남 담양군 남면 소쇄원길 17 (지곡리)",
    locationNote:
      "국가유산청이 공개한 담양소쇄원의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-12968d0538d3": {
    coordinates: [128.45478, 36.652033],
    kind: "site",
    modernName: "경북 예천군 예천읍 남본리 200-3번지",
    locationNote:
      "국가유산청이 공개한 예천 개심사지 오층석탑의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-f5c8b61aaadc": {
    coordinates: [127.053933, 35.723112],
    kind: "site",
    modernName: "전북 김제시 금산면 모악15길 1, 금산사 (금산리)",
    locationNote:
      "국가유산청이 공개한 김제 금산사 미륵전의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-09a5e4baa822": {
    coordinates: [127.497211, 35.257238],
    kind: "site",
    modernName:
      "전남광주통합특별시 구례군 마산면 화엄사로 539, 화엄사 (황전리) / (지번)전남 구례군 마산면 황전리 12 화엄사",
    locationNote:
      "국가유산청이 공개한 구례 화엄사 각황전의 등록 위치이다. 유적 전체의 경계나 전투 범위를 뜻하지 않는다.",
  },
  "kr-8ced6b94e17d": {
    name: "중경 현덕부",
    coordinates: [129.14407, 42.71226],
    kind: "settlement",
    locationNote:
      "발해 중경으로 비정되는 중국 지린성 허룽의 서고성 유적 대표점이다. 발해 현덕부의 행정 영역을 표시한 점이 아니다.",
    aliases: ["중경", "중경(발해)", "서고성"],
  },
  "kr-46ab0f59d5f6": {
    name: "동경 용원부",
    coordinates: [130.283, 42.85831],
    kind: "settlement",
    locationNote:
      "발해 동경으로 비정되는 중국 지린성 훈춘의 팔련성 유적 대표점이다. 용원부의 행정 영역을 표시한 점이 아니다.",
    aliases: ["동경", "동경(발해)", "용원부", "용원부 동경", "팔련성"],
  },
  "kr-c27023f3c34a": {
    name: "남경 남해부",
    coordinates: [128.421667, 40.160833],
    kind: "settlement",
    locationNote:
      "발해 남경으로 비정되는 북청 청해토성의 대표점이다. 위치에 관한 다른 견해도 있으며, 남해부 전체의 경계를 뜻하지 않는다.",
    aliases: ["남경", "남경(발해)", "청해토성"],
  },
  "kr-0a314eeac193": {
    name: "서경 압록부",
    coordinates: [126.91, 41.81],
    kind: "settlement",
    locationNote:
      "발해 서경으로 비정되는 중국 지린성 린장 일대를 나타내는 근사 위치이다. 도성의 정확한 발굴 지점이나 압록부 전체의 경계를 뜻하지 않는다.",
    aliases: ["서경", "서경(발해)", "린장"],
  },
  "kr-a34472ffacdf": {
    name: "명량",
    coordinates: [126.303947, 34.572386],
    kind: "water",
    locationNote:
      "한국학중앙연구원 전자지도의 명량대첩 대표 위치이다. 해남과 진도 사이 울돌목 해역을 가리키며, 함선 이동이나 전투 범위를 정밀 복원한 점은 아니다.",
    aliases: ["울돌목", "명량해협"],
  },
  "kr-f8f6a36df2ea": {
    name: "노량",
    coordinates: [127.858493, 34.944265],
    kind: "water",
    locationNote:
      "한국학중앙연구원 전자지도의 노량해전 대표 위치이다. 남해도와 하동 사이 해협 일대를 가리키며, 함선 이동이나 전투 범위를 정밀 복원한 점은 아니다.",
    aliases: ["노량해협"],
  },
  "kr-361994b9d007": {
    name: "옥포",
    coordinates: [128.739381, 34.899692],
    kind: "water",
    locationNote:
      "한국학중앙연구원 전자지도의 옥포해전 대표 위치이다. 거제 옥포 앞바다를 가리키며, 현대 옥포동의 행정 중심이나 전투 범위를 정밀 복원한 점은 아니다.",
    aliases: ["옥포해전", "옥포 앞바다"],
  },
};

export const atlasKoreaRestoredLocationEvidence: Record<
  string,
  {
    title: string;
    url: string;
    coordinateUrl: string;
    coordinateTitle?: string;
    license?: string;
    licenseUrl?: string;
    precision:
      | "registered-site"
      | "identified-site"
      | "approximate-locality"
      | "battle-area";
  }
> = {
  "kr-42182b7d5100": {
    title: "국가유산청 국가유산포털 — 김해 구지봉",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333804290000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0004290000000&ccbaCtcd=38",
    precision: "registered-site",
  },
  "kr-41355b2ef6ea": {
    title: "국가유산청 국가유산포털 — 김해 수로왕릉",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333800730000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0000730000000&ccbaCtcd=38",
    precision: "registered-site",
  },
  "kr-43c62744a4f4": {
    title: "국가유산청 국가유산포털 — 경주 월성",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333700160000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0000160000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-77b320dc1ed4": {
    title: "국가유산청 국가유산포털 — 충주 고구려비",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113302050000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0002050000000&ccbaCtcd=33",
    precision: "registered-site",
  },
  "kr-fb038027b398": {
    title: "국가유산청 국가유산포털 — 단양 적성",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333302650000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0002650000000&ccbaCtcd=33",
    precision: "registered-site",
  },
  "kr-20b36ef183a5": {
    title: "국가유산청 국가유산포털 — 서울 풍납동 토성",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1331100110000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0000110000000&ccbaCtcd=11",
    precision: "registered-site",
  },
  "kr-49b31c53bf7a": {
    title: "국가유산청 국가유산포털 — 공주 공산성",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333400120000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0000120000000&ccbaCtcd=34",
    precision: "registered-site",
  },
  "kr-ef0b3d79916d": {
    title: "국가유산청 국가유산포털 — 하남 이성산성",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333104220000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0004220000000&ccbaCtcd=31",
    precision: "registered-site",
  },
  "kr-a76f02643cdd": {
    title: "국가유산청 국가유산포털 — 고령 지산동 고분군",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333700790000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0000790000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-cc53fabf10ab": {
    title: "국가유산청 국가유산포털 — 서산 용현리 마애여래삼존상",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113400840000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000840000000&ccbaCtcd=34",
    precision: "registered-site",
  },
  "kr-74eb96d6661b": {
    title: "국가유산청 국가유산포털 — 보은 삼년산성",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333302350000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0002350000000&ccbaCtcd=33",
    precision: "registered-site",
  },
  "kr-84e61b3eab9a": {
    title: "국가유산청 국가유산포털 — 경주 태종무열왕릉비",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113700250000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000250000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-6f68810a2fb8": {
    title: "국가유산청 국가유산포털 — 합천 해인사 길상탑",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123812420000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=12&ccbaAsno=0012420000000&ccbaCtcd=38",
    precision: "registered-site",
  },
  "kr-6bae6070884f": {
    title: "국가유산청 국가유산포털 — 경주 동궁과 월지",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333700180000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0000180000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-507555e467bd": {
    title: "국가유산청 국가유산포털 — 경주 불국사 대웅전",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123717440000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=12&ccbaAsno=0017440000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-c80fa65a1d43": {
    title: "국가유산청 국가유산포털 — 경주 불국사 다보탑",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113700200000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000200000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-699f2c61ea69": {
    title: "국가유산청 국가유산포털 — 경주 불국사 삼층석탑",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113700210000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000210000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-feb96c06aa14": {
    title: "국가유산청 국가유산포털 — 진도 용장성",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333601260000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0001260000000&ccbaCtcd=36",
    precision: "registered-site",
  },
  "kr-1ed4b496dccb": {
    title: "국가유산청 국가유산포털 — 강화 삼랑성",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1332301300000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0001300000000&ccbaCtcd=23",
    precision: "registered-site",
  },
  "kr-6185d7d2721d": {
    title: "국가유산청 국가유산포털 — 합천 해인사 장경판전",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113800520000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000520000000&ccbaCtcd=38",
    precision: "registered-site",
  },
  "kr-b6bcc939acd8": {
    title: "국가유산청 국가유산포털 — 안동 병산서원",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333702600000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0002600000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-a38fd43eddde": {
    title: "국가유산청 국가유산포털 — 용인 심곡서원",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333105300000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0005300000000&ccbaCtcd=31",
    precision: "registered-site",
  },
  "kr-442fb975dab0": {
    title: "국가유산청 국가유산포털 — 안동 병산서원 만대루",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123721040000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=12&ccbaAsno=0021040000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-c3b00a1be92c": {
    title: "국가유산청 국가유산포털 — 안동 도산서원",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333701700000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0001700000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-862bd72c7740": {
    title: "국가유산청 국가유산포털 — 영주 소수서원",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333700550000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0000550000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-33b188925aa0": {
    title: "국가유산청 국가유산포털 — 경주 옥산서원",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333701540000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0001540000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-10bb079a880b": {
    title: "국가유산청 국가유산포털 — 함양 남계서원",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333804990000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0004990000000&ccbaCtcd=38",
    precision: "registered-site",
  },
  "kr-333194fa9ac9": {
    title: "국가유산청 국가유산포털 — 장성 필암서원",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333602420000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0002420000000&ccbaCtcd=36",
    precision: "registered-site",
  },
  "kr-cd245446c0da": {
    title: "국가유산청 국가유산포털 — 논산 돈암서원",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333403830000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0003830000000&ccbaCtcd=34",
    precision: "registered-site",
  },
  "kr-93464ab4266a": {
    title: "국가유산청 국가유산포털 — 서울 흥인지문",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1121100010000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=12&ccbaAsno=0000010000000&ccbaCtcd=11",
    precision: "registered-site",
  },
  "kr-6b7944097ae7": {
    title: "국가유산청 국가유산포털 — 서울 삼전도비",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1331101010000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0001010000000&ccbaCtcd=11",
    precision: "registered-site",
  },
  "kr-ddd7324d743e": {
    title: "국가유산청 국가유산포털 — 수원 화성",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333100030000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0000030000000&ccbaCtcd=31",
    precision: "registered-site",
  },
  "kr-6a142297546f": {
    title: "국가유산청 국가유산포털 — 진주성",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333801180000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0001180000000&ccbaCtcd=38",
    precision: "registered-site",
  },
  "kr-08bd6fdf1ad4": {
    title: "국가유산청 국가유산포털 — 서울 명동성당",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1331102580000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0002580000000&ccbaCtcd=11",
    precision: "registered-site",
  },
  "kr-729119e6b9f6": {
    title: "국가유산청 국가유산포털 — 경복궁 근정전",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1111102230000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0002230000000&ccbaCtcd=11",
    precision: "registered-site",
  },
  "kr-21cbecd852a8": {
    title: "국가유산청 국가유산포털 — 서울 우정총국",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1331102130000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0002130000000&ccbaCtcd=11",
    precision: "registered-site",
  },
  "kr-f408a789b2b0": {
    title: "국가유산청 국가유산포털 — 서울 독립문",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1331100320000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0000320000000&ccbaCtcd=11",
    precision: "registered-site",
  },
  "kr-18b733ab896a": {
    title: "국가유산청 국가유산포털 — 덕수궁",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1331101240000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0001240000000&ccbaCtcd=11",
    precision: "registered-site",
  },
  "kr-bcf851da163c": {
    title: "국가유산청 국가유산포털 — 김제 벽골제",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333501110000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0001110000000&ccbaCtcd=35",
    precision: "registered-site",
  },
  "kr-a52af3e9391a": {
    title: "국가유산청 국가유산포털 — 경주 분황사 모전석탑",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113700300000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000300000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-667444e22c99": {
    title: "국가유산청 국가유산포털 — 경주 김유신묘",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333700210000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0000210000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-c2fe1ffb423e": {
    title: "국가유산청 국가유산포털 — 경주 문무대왕릉",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333701580000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0001580000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-6ae2d4695ab4": {
    title: "국가유산청 국가유산포털 — 사천 흥사리 매향비",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123806140000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=12&ccbaAsno=0006140000000&ccbaCtcd=38",
    precision: "registered-site",
  },
  "kr-66c7b07aacdd": {
    title: "국가유산청 국가유산포털 — 영주 부석사 무량수전",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113700180000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000180000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-254b01e6cf36": {
    title: "국가유산청 국가유산포털 — 안동 도산서원 전교당",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123702100000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=12&ccbaAsno=0002100000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-ed8ad25e7791": {
    title: "국가유산청 국가유산포털 — 수원 화성행궁",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333104780000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0004780000000&ccbaCtcd=31",
    precision: "registered-site",
  },
  "kr-d18f7d3b24ac": {
    title: "국가유산청 국가유산포털 — 수원 서북공심돈",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123117100000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=12&ccbaAsno=0017100000000&ccbaCtcd=31",
    precision: "registered-site",
  },
  "kr-2ad7f0aa1fec": {
    title: "국가유산청 국가유산포털 — 보은 법주사 팔상전",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113300550000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000550000000&ccbaCtcd=33",
    precision: "registered-site",
  },
  "kr-50dba735c9cb": {
    title: "국가유산청 국가유산포털 — 환구단",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1331101570000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0001570000000&ccbaCtcd=11",
    precision: "registered-site",
  },
  "kr-ef4605ebde38": {
    title: "국가유산청 국가유산포털 — 서울 몽촌토성",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1331102970000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0002970000000&ccbaCtcd=11",
    precision: "registered-site",
  },
  "kr-55ca4e33a315": {
    title: "국가유산청 국가유산포털 — 익산 왕궁리 유적",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333504080000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0004080000000&ccbaCtcd=35",
    precision: "registered-site",
  },
  "kr-6e8e468357ba": {
    title: "국가유산청 국가유산포털 — 부여 정림사지",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333403010000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0003010000000&ccbaCtcd=34",
    precision: "registered-site",
  },
  "kr-ab144d954c89": {
    title: "국가유산청 국가유산포털 — 경주 첨성대",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113700310000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000310000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-a5382a629d33": {
    title: "국가유산청 국가유산포털 — 익산 미륵사지 석탑",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113500110000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000110000000&ccbaCtcd=35",
    precision: "registered-site",
  },
  "kr-811a130012b1": {
    title: "국가유산청 국가유산포털 — 경주 포석정지",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333700010000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0000010000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-9cac2157f1bd": {
    title: "국가유산청 국가유산포털 — 경주 남산동 동·서 삼층석탑",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123701240000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=12&ccbaAsno=0001240000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-3a0fd059efbe": {
    title: "국가유산청 국가유산포털 — 경주 남산 칠불암 마애불상군",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113703120000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0003120000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-dbef1a053624": {
    title: "국가유산청 국가유산포털 — 경주 감은사지 동·서 삼층석탑",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113701120000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0001120000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-276508faea83": {
    title: "국가유산청 국가유산포털 — 경주 남산 용장사곡 삼층석탑",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123701860000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=12&ccbaAsno=0001860000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-dc2217fc4814": {
    title: "국가유산청 국가유산포털 — 청주 용두사지 철당간",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113300410000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000410000000&ccbaCtcd=33",
    precision: "registered-site",
  },
  "kr-b22fa37b3b12": {
    title: "국가유산청 국가유산포털 — 안동 이천동 마애여래입상",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123701150000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=12&ccbaAsno=0001150000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-d4c3c667b774": {
    title: "국가유산청 국가유산포털 — 평창 월정사 팔각 구층석탑",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113200480000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000480000100&ccbaCtcd=51",
    precision: "registered-site",
  },
  "kr-f86f6fabbb8e": {
    title: "국가유산청 국가유산포털 — 안동 봉정사 극락전",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113700150000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000150000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-c4a88522c0dc": {
    title: "국가유산청 국가유산포털 — 예산 수덕사 대웅전",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113400490000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000490000000&ccbaCtcd=34",
    precision: "registered-site",
  },
  "kr-556d652da2f8": {
    title: "국가유산청 국가유산포털 — 창경궁",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1331101230000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0001230000000&ccbaCtcd=11",
    precision: "registered-site",
  },
  "kr-44484ff2c209": {
    title: "국가유산청 국가유산포털 — 경복궁 경회루",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1111102240000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0002240000000&ccbaCtcd=11",
    precision: "registered-site",
  },
  "kr-8081f9dbac47": {
    title: "국가유산청 국가유산포털 — 고양 행주산성",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333100560000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0000560000000&ccbaCtcd=31",
    precision: "registered-site",
  },
  "kr-27c2834499ea": {
    title: "국가유산청 국가유산포털 — 수원 팔달문",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123104020000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=12&ccbaAsno=0004020000000&ccbaCtcd=31",
    precision: "registered-site",
  },
  "kr-dcd62974da10": {
    title: "국가유산청 국가유산포털 — 창덕궁 주합루",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1121117690000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=12&ccbaAsno=0017690000000&ccbaCtcd=11",
    precision: "registered-site",
  },
  "kr-2261bcc0d80e": {
    title: "국가유산청 국가유산포털 — 서울 구 러시아공사관",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1331102530000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0002530000000&ccbaCtcd=11",
    precision: "registered-site",
  },
  "kr-296dbe381817": {
    title: "국가유산청 국가유산포털 — 부여 정림사지 오층석탑",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113400090000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000090000000&ccbaCtcd=34",
    precision: "registered-site",
  },
  "kr-e7b46df31236": {
    title: "국가유산청 국가유산포털 — 경주 배동 석조여래삼존입상",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123700630000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=12&ccbaAsno=0000630000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-6867c80f9a0f": {
    title: "국가유산청 국가유산포털 — 화순 쌍봉사 철감선사탑",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113600570000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000570000000&ccbaCtcd=36",
    precision: "registered-site",
  },
  "kr-b66ceee33052": {
    title: "국가유산청 국가유산포털 — 경주 불국사 청운교 및 백운교",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113700230000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000230000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-2b45a1718a45": {
    title: "국가유산청 국가유산포털 — 담양소쇄원",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333603040000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=13&ccbaAsno=0003040000000&ccbaCtcd=36",
    precision: "registered-site",
  },
  "kr-12968d0538d3": {
    title: "국가유산청 국가유산포털 — 예천 개심사지 오층석탑",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1112512180002",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0003530000000&ccbaCtcd=37",
    precision: "registered-site",
  },
  "kr-f5c8b61aaadc": {
    title: "국가유산청 국가유산포털 — 김제 금산사 미륵전",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113500620000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000620000000&ccbaCtcd=35",
    precision: "registered-site",
  },
  "kr-09a5e4baa822": {
    title: "국가유산청 국가유산포털 — 구례 화엄사 각황전",
    url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113600670000",
    coordinateUrl:
      "https://www.khs.go.kr/cha/SearchKindOpenapiDt.do?ccbaKdcd=11&ccbaAsno=0000670000000&ccbaCtcd=36",
    precision: "registered-site",
  },
  "kr-8ced6b94e17d": {
    title: "국사편찬위원회 — 발해 중경 현덕부",
    url: "https://db.history.go.kr/diachronic/level.do?levelId=hn_034_0030_0030_0020",
    coordinateUrl: "https://zh.wikipedia.org/wiki/渤海中京城遗址",
    precision: "identified-site",
    coordinateTitle: "위키백과 — 발해 중경성 유적 좌표",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
  "kr-46ab0f59d5f6": {
    title: "국사편찬위원회 — 발해 동경 용원부",
    url: "https://db.history.go.kr/diachronic/level.do?levelId=hn_034_0030_0030_0030",
    coordinateUrl: "https://www.openstreetmap.org/way/688569789",
    precision: "identified-site",
    coordinateTitle: "OpenStreetMap 기여자 — 팔련성 유적, way 688569789",
    license: "ODbL 1.0",
    licenseUrl: "https://www.openstreetmap.org/copyright",
  },
  "kr-c27023f3c34a": {
    title: "국사편찬위원회 — 발해 남경 남해부",
    url: "https://db.history.go.kr/diachronic/level.do?levelId=hn_034_0030_0030_0040",
    coordinateUrl:
      "https://ipus.snu.ac.kr/wp-content/uploads/2021/04/%EA%B2%8C%EC%9E%AC%EC%9A%A9-%EC%9D%B8%EB%AC%B8%ED%95%99%EC%97%B0%EA%B5%AC%EC%9B%90-%EB%AC%B8%ED%99%94%EC%9C%A0%EC%82%B0%EC%97%B0%EA%B5%AC%EC%86%8C%EC%9D%B4%EC%84%A0%EB%B3%B5-%EA%B5%90%EC%88%98_2020-%ED%86%B5%EC%9D%BC%EA%B8%B0%EB%B0%98%EA%B5%AC%EC%B6%95%EC%82%AC%EC%97%85-%EA%B2%B0%EA%B3%BC%EB%B3%B4%EA%B3%A0%EC%84%9C.pdf#page=64",
    precision: "identified-site",
    coordinateTitle:
      "서울대학교 문화유산연구소 — 북한 문화유산 관리 현황 연구(3), 부록 청해토성 좌표",
  },
  "kr-0a314eeac193": {
    title: "국사편찬위원회 — 발해 서경 압록부",
    url: "https://db.history.go.kr/diachronic/level.do?levelId=hn_034_0030_0030_0050",
    coordinateUrl: "https://www.geonames.org/2036069/linjiang.html",
    precision: "approximate-locality",
    coordinateTitle:
      "GeoNames — Linjiang 2036069, 시가지 대표 좌표를 소수 둘째 자리로 반올림",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  },
  "kr-a34472ffacdf": {
    title: "한국학중앙연구원 — 이순신 해전 전적지",
    url: "https://dh.aks.ac.kr/Encyves/wiki/index.php/민족기록화_전자지도",
    coordinateUrl:
      "https://dh.aks.ac.kr/Encyves/wiki/index.php/민족기록화_전자지도",
    precision: "battle-area",
  },
  "kr-f8f6a36df2ea": {
    title: "한국학중앙연구원 — 이순신 해전 전적지",
    url: "https://dh.aks.ac.kr/Encyves/wiki/index.php/민족기록화_전자지도",
    coordinateUrl:
      "https://dh.aks.ac.kr/Encyves/wiki/index.php/민족기록화_전자지도",
    precision: "battle-area",
  },
  "kr-361994b9d007": {
    title: "한국학중앙연구원 — 이순신 해전 전적지",
    url: "https://dh.aks.ac.kr/Encyves/wiki/index.php/민족기록화_전자지도",
    coordinateUrl:
      "https://dh.aks.ac.kr/Encyves/wiki/index.php/민족기록화_전자지도",
    precision: "battle-area",
  },
};

export const atlasKoreaRestoredHistoricalStories: AtlasHistoricalStory[] = [
  {
    id: "korea-restored-gujibong",
    subject: "korea",
    placeIds: ["kr-42182b7d5100"],
    title: "가야 건국 설화가 전해지는 구지봉",
    period: "가야 건국 설화",
    startYear: 42,
    eraIds: ["k-early-states"],
    summary:
      "구지봉은 『삼국유사』 가락국기에 수로왕의 탄생 장소로 등장하는 언덕이다. 구지가를 부르며 왕을 맞았다는 이야기는 금관가야의 건국 전승을 보여 준다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 김해 구지봉",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333804290000",
      },
    ],
    related: [
      {
        placeId: "kr-41355b2ef6ea",
        targetEntryId: "story-korea-restored-suro-tomb-kr-41355b2ef6ea",
        reason:
          "구지봉의 건국 설화와 수로왕릉은 김해에서 전해 온 수로왕의 탄생과 추모 전통을 보여 준다.",
      },
    ],
  },
  {
    id: "korea-restored-suro-tomb",
    subject: "korea",
    placeIds: ["kr-41355b2ef6ea"],
    title: "수로왕을 기리는 왕릉",
    period: "조선, 1446년",
    startYear: 1446,
    eraIds: ["k-joseon-early"],
    summary:
      "김해 수로왕릉은 금관가야를 세운 수로왕의 무덤으로 전해지는 곳이다. 조선 세종은 1446년 왕릉 주변의 보호 구역을 넓혀 가야 시조의 무덤을 보존하도록 했다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 김해 수로왕릉",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333800730000",
      },
    ],
    related: [
      {
        placeId: "kr-42182b7d5100",
        targetEntryId: "story-korea-restored-gujibong-kr-42182b7d5100",
        reason:
          "구지봉의 건국 설화와 수로왕릉은 김해에서 전해 온 수로왕의 탄생과 추모 전통을 보여 준다.",
        fromPlaceIds: ["kr-41355b2ef6ea"],
      },
    ],
  },
  {
    id: "korea-restored-chungju-stele",
    subject: "korea",
    placeIds: ["kr-77b320dc1ed4"],
    title: "남한강 유역에 남은 고구려의 기록",
    period: "5세기 무렵",
    startYear: 400,
    eraIds: ["k-three-kingdoms"],
    summary:
      "충주 고구려비는 고구려가 남한강 유역까지 세력을 넓혔음을 보여 주는 비석이다. 비문에는 고구려와 신라의 관계가 기록되어 있으며, 건립 시기는 장수왕 때로 추정된다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 충주 고구려비",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113302050000",
      },
    ],
    endYear: 499,
  },
  {
    id: "korea-restored-jeokseong",
    subject: "korea",
    placeIds: ["kr-fb038027b398"],
    title: "신라의 한강 상류 진출",
    period: "6세기",
    startYear: 500,
    eraIds: ["k-three-kingdoms"],
    summary:
      "단양 적성은 신라가 한강 상류로 진출하며 확보한 산성이다. 성 안에서 발견된 적성비에는 진흥왕 때 신라를 도운 사람과 그 가족에게 포상한 내용이 남아 있다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 단양 적성",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333302650000",
      },
    ],
    endYear: 599,
  },
  {
    id: "korea-restored-pungnap",
    subject: "korea",
    placeIds: ["kr-20b36ef183a5"],
    title: "한성백제의 왕성을 찾는 단서",
    period: "백제 한성기",
    startYear: 1,
    eraIds: ["k-three-kingdoms"],
    summary:
      "풍납토성은 한강 남쪽에 큰 흙벽을 쌓아 만든 백제의 성이다. 대규모 성벽과 건물터·유물은 이곳이 한성백제의 왕성이었음을 뒷받침한다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 서울 풍납동 토성",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1331100110000",
      },
    ],
    endYear: 475,
  },
  {
    id: "korea-restored-seosan-buddhas",
    subject: "korea",
    placeIds: ["kr-cc53fabf10ab"],
    title: "바위에 새긴 백제의 미소",
    period: "6세기 말~7세기 초",
    startYear: 580,
    eraIds: ["k-three-kingdoms"],
    summary:
      "서산 용현리 마애여래삼존상은 절벽에 새긴 세 불상이다. 온화한 미소와 세련된 조각은 백제 불교미술의 특징이며, 중국과 교류하던 태안반도와 사비를 잇는 길목에 남아 있다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 서산 용현리 마애여래삼존상",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113400840000",
      },
    ],
    endYear: 620,
  },
  {
    id: "korea-restored-muyeol-stele",
    subject: "korea",
    placeIds: ["kr-84e61b3eab9a"],
    title: "태종무열왕을 기리는 비석",
    period: "신라, 661년",
    startYear: 661,
    eraIds: ["k-three-kingdoms"],
    summary:
      "태종무열왕릉비는 김춘추가 죽은 661년에 세운 비석이다. 비의 몸돌은 없어졌지만 거북 모양 받침과 용을 새긴 머릿돌이 남아 신라 왕실의 조각·서예 문화를 보여 준다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 경주 태종무열왕릉비",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113700250000",
      },
    ],
  },
  {
    id: "korea-restored-bulguksa-hall",
    subject: "korea",
    placeIds: ["kr-507555e467bd"],
    title: "전란 뒤 다시 세운 불국사 대웅전",
    period: "조선, 1765년",
    startYear: 1765,
    eraIds: ["k-joseon-late"],
    summary:
      "불국사 대웅전은 석가모니불을 모시는 중심 법당이다. 임진왜란 때 불탄 뒤 여러 차례 다시 지었으며, 현재 건물은 통일신라의 기단 위에 1765년 중창한 조선 후기 건축이다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 경주 불국사 대웅전",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123717440000",
      },
    ],
  },
  {
    id: "korea-restored-dabotap",
    subject: "korea",
    placeIds: ["kr-c80fa65a1d43"],
    title: "두 탑으로 표현한 불교 세계",
    period: "통일신라, 8세기",
    startYear: 700,
    eraIds: ["k-unified-silla"],
    summary:
      "불국사 다보탑은 대웅전 앞에서 석가탑과 마주 선 석탑이다. 복잡하고 장식적인 모습의 다보탑과 간결한 석가탑은 서로 다른 부처를 상징하며 통일신라 석조 기술을 보여 준다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 경주 불국사 다보탑",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113700200000",
      },
    ],
    endYear: 799,
    related: [
      {
        placeId: "kr-b66ceee33052",
        targetEntryId: "story-korea-restored-baegungyo-kr-b66ceee33052",
        reason:
          "다보탑은 백운교와 청운교를 올라 들어가는 불국사 대웅전 앞마당에 서 있다.",
      },
    ],
  },
  {
    id: "korea-restored-samnangseong",
    subject: "korea",
    placeIds: ["kr-1ed4b496dccb"],
    title: "병인양요 때 프랑스군을 막은 산성",
    period: "조선, 1866년",
    startYear: 1866,
    eraIds: ["k-joseon-late"],
    summary:
      "강화 삼랑성은 정족산성이라고도 부르는 산성이다. 1866년 병인양요 때 조선군은 이 성을 이용해 공격해 온 프랑스군을 물리쳤다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 강화 삼랑성",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1332301300000",
      },
    ],
  },
  {
    id: "korea-restored-simgok",
    subject: "korea",
    placeIds: ["kr-a38fd43eddde"],
    title: "조광조를 기리는 서원",
    period: "조선, 17세기",
    startYear: 1600,
    eraIds: ["k-joseon-late"],
    summary:
      "용인 심곡서원은 조선 중종 때 개혁을 추진한 조광조를 기리고 유생을 가르치던 서원이다. 흥선대원군의 서원 철폐 때도 남아 제향과 교육의 전통을 이어 갔다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 용인 심곡서원",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333105300000",
      },
    ],
    endYear: 1699,
  },
  {
    id: "korea-restored-mandaeru",
    subject: "korea",
    placeIds: ["kr-442fb975dab0"],
    title: "병산서원의 강학 공간",
    period: "조선",
    startYear: 1600,
    eraIds: ["k-joseon-late"],
    summary:
      "만대루는 병산서원 앞쪽에 세운 누각으로, 유생들이 함께 모여 쉬거나 학문을 논하던 공간이다. 낙동강과 병산을 향해 열린 구조는 서원 교육 공간과 주변 자연을 연결한다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 안동 병산서원 만대루",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123721040000",
      },
    ],
    endYear: 1895,
    related: [
      {
        placeId: "kr-b6bcc939acd8",
        targetEntryId: "story-korea-byeongsan-kr-b6bcc939acd8",
        reason:
          "만대루는 유성룡을 기리는 병산서원의 유생들이 함께 모이던 누각이다.",
      },
    ],
  },
  {
    id: "korea-restored-oksan",
    subject: "korea",
    placeIds: ["kr-33b188925aa0"],
    title: "이언적의 학문을 이어 간 서원",
    period: "조선, 1572년",
    startYear: 1572,
    eraIds: ["k-joseon-early"],
    summary:
      "경주 옥산서원은 성리학자 이언적을 기리기 위해 1572년 세웠다. 이듬해 사액을 받았으며, 제향과 강학을 통해 영남 지역 유학의 전통을 이어 갔다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 경주 옥산서원",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333701540000",
      },
    ],
  },
  {
    id: "korea-restored-namgye",
    subject: "korea",
    placeIds: ["kr-10bb079a880b"],
    title: "정여창을 기리는 사림의 서원",
    period: "조선, 1552년",
    startYear: 1552,
    eraIds: ["k-joseon-early"],
    summary:
      "함양 남계서원은 1552년 정여창의 학문과 덕행을 기리기 위해 세웠다. 정유재란 때 불탔다가 다시 건립되어, 지역 사림이 선현을 제사하고 유생을 가르치는 공간이 되었다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 함양 남계서원",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333804990000",
      },
    ],
  },
  {
    id: "korea-restored-piram",
    subject: "korea",
    placeIds: ["kr-333194fa9ac9"],
    title: "김인후의 학문을 기리는 서원",
    period: "조선, 1590~1672년",
    startYear: 1590,
    eraIds: ["k-joseon-early"],
    summary:
      "장성 필암서원은 1590년 김인후를 기리기 위해 세운 서원이다. 정유재란으로 불탄 뒤 다시 세웠으며, 1672년 현재 위치로 옮겨 교육과 제향을 이어 갔다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 장성 필암서원",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333602420000",
      },
    ],
    endYear: 1672,
  },
  {
    id: "korea-restored-donam",
    subject: "korea",
    placeIds: ["kr-cd245446c0da"],
    title: "김장생의 예학을 이어 간 서원",
    period: "조선, 1634년",
    startYear: 1634,
    eraIds: ["k-joseon-late"],
    summary:
      "논산 돈암서원은 1634년 김장생을 기리기 위해 세웠다. 예법을 중시한 그의 학문을 이어 가며 충청 지역 유생들의 교육과 제향을 담당했다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 논산 돈암서원",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333403830000",
      },
    ],
  },
  {
    id: "korea-restored-heunginjimun",
    subject: "korea",
    placeIds: ["kr-93464ab4266a"],
    title: "한양 도성의 동쪽 관문",
    period: "조선, 1396~1869년",
    startYear: 1396,
    eraIds: ["k-joseon-early"],
    summary:
      "흥인지문은 한양 도성의 동쪽 큰 문이다. 태조 때 처음 세웠으며, 현재의 문루는 1869년에 다시 지은 것으로 도성 출입과 방어를 맡았던 시설이다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 서울 흥인지문",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1121100010000",
      },
    ],
    endYear: 1869,
  },
  {
    id: "korea-restored-post-office",
    subject: "korea",
    placeIds: ["kr-21cbecd852a8"],
    title: "근대 우편의 시작과 갑신정변",
    period: "조선, 1884년",
    startYear: 1884,
    eraIds: ["k-opening"],
    summary:
      "우정총국은 1884년 근대식 우편 업무를 시작한 관청이다. 개업 축하연을 계기로 갑신정변이 일어났고, 정변 실패 뒤 우편 사업도 중단되었다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 서울 우정총국",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1331102130000",
      },
    ],
  },
  {
    id: "korea-restored-byeokgolje",
    subject: "korea",
    placeIds: ["kr-bcf851da163c"],
    title: "농업 생산을 뒷받침한 수리시설",
    period: "삼국시대~조선",
    startYear: 300,
    eraIds: ["k-three-kingdoms"],
    summary:
      "김제 벽골제는 넓은 평야에서 물을 관리하기 위해 만든 대규모 수리시설이다. 남아 있는 제방과 수문 돌기둥은 고대의 토목 기술과 농업 생산 기반을 보여 준다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 김제 벽골제",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333501110000",
      },
    ],
    endYear: 1895,
  },
  {
    id: "korea-restored-munmu-tomb",
    subject: "korea",
    placeIds: ["kr-c2fe1ffb423e"],
    title: "문무왕의 장례 전승이 남은 바다",
    period: "통일신라, 681년",
    startYear: 681,
    eraIds: ["k-unified-silla"],
    summary:
      "문무대왕릉은 동해의 바위섬으로, 신라 문무왕의 유해를 모신 곳으로 전해진다. 바다의 용이 되어 나라를 지키겠다는 문무왕의 유언과 연결되는 유적이다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 경주 문무대왕릉",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333701580000",
      },
    ],
    related: [
      {
        placeId: "kr-dbef1a053624",
        targetEntryId: "story-korea-restored-gameunsa-pagodas-kr-dbef1a053624",
        reason:
          "문무대왕릉의 호국 전승과 감은사의 창건은 문무왕을 기리고 나라의 안정을 기원한 불교 신앙으로 이어진다.",
      },
    ],
  },
  {
    id: "korea-restored-maehyang",
    subject: "korea",
    placeIds: ["kr-6ae2d4695ab4"],
    title: "고려 말 공동체의 바람을 새긴 비",
    period: "고려, 1387년",
    startYear: 1387,
    eraIds: ["k-goryeo"],
    summary:
      "사천 흥사리 매향비는 1387년 승려와 주민들이 향나무를 묻는 의식을 치르고 세운 비석이다. 나라의 안정과 백성의 평안을 기원한 기록은 고려 말 지역 공동체의 불교 신앙을 보여 준다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 사천 흥사리 매향비",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123806140000",
      },
    ],
  },
  {
    id: "korea-restored-jeongyodang",
    subject: "korea",
    placeIds: ["kr-254b01e6cf36"],
    title: "도산서원에서 유생을 가르치던 강당",
    period: "조선, 1574년",
    startYear: 1574,
    eraIds: ["k-joseon-early"],
    summary:
      "전교당은 도산서원의 중심 강당으로 유생들이 공부하고 모임을 열던 건물이다. 이황을 기리는 도산서원이 1574년 세워질 때 함께 건립되어 서원의 교육 기능을 맡았다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 안동 도산서원 전교당",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123702100000",
      },
    ],
    related: [
      {
        placeId: "kr-c3b00a1be92c",
        targetEntryId: "story-korea-dosan-kr-c3b00a1be92c",
        reason:
          "전교당은 이황을 기리는 도산서원에서 유생을 가르치던 중심 강당이다.",
      },
    ],
  },
  {
    id: "korea-restored-gongsimdon",
    subject: "korea",
    placeIds: ["kr-d18f7d3b24ac"],
    title: "수원 화성의 관측과 화포 방어",
    period: "조선, 1796년",
    startYear: 1796,
    eraIds: ["k-joseon-late"],
    summary:
      "서북공심돈은 수원 화성 성벽 위에 세운 방어시설이다. 안에서 적의 움직임을 살피고 총포를 쏠 수 있도록 설계하여 정조 때 발전한 축성 기술을 보여 준다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 수원 서북공심돈",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123117100000",
      },
    ],
    related: [
      {
        placeId: "kr-27c2834499ea",
        targetEntryId: "story-korea-restored-paldalmun-kr-27c2834499ea",
        reason:
          "서북공심돈과 팔달문은 정조 때 건설한 수원 화성의 관측·방어와 출입을 맡은 시설이다.",
      },
    ],
  },
  {
    id: "korea-restored-palsangjeon",
    subject: "korea",
    placeIds: ["kr-2ad7f0aa1fec"],
    title: "임진왜란 뒤 다시 지은 목탑",
    period: "조선, 1625년",
    startYear: 1625,
    eraIds: ["k-joseon-late"],
    summary:
      "법주사 팔상전은 부처의 생애를 여덟 장면으로 그린 그림을 봉안한 오층 목탑이다. 임진왜란으로 불탄 뒤 다시 지어 조선시대 목조 탑의 구조를 전한다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 보은 법주사 팔상전",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113300550000",
      },
    ],
  },
  {
    id: "korea-restored-mireuk-pagoda",
    subject: "korea",
    placeIds: ["kr-a5382a629d33"],
    title: "백제의 목탑 구조를 옮긴 석탑",
    period: "백제, 7세기",
    startYear: 600,
    eraIds: ["k-three-kingdoms"],
    summary:
      "익산 미륵사지 석탑은 백제 무왕 때 세운 미륵사에 남은 석탑이다. 기둥과 지붕을 돌로 표현한 방식은 목탑의 구조가 석탑으로 옮겨 가는 모습을 보여 준다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 익산 미륵사지 석탑",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113500110000",
      },
    ],
    endYear: 699,
  },
  {
    id: "korea-restored-poseokjeong",
    subject: "korea",
    placeIds: ["kr-811a130012b1"],
    title: "신라 왕실 의례 공간의 물길",
    period: "통일신라, 9세기 무렵",
    startYear: 800,
    eraIds: ["k-unified-silla"],
    summary:
      "포석정지에는 물을 굽이쳐 흐르게 한 돌 홈이 남아 있다. 신라 왕실이 이용한 공간으로, 물 위에 잔을 띄우는 유상곡수의 흔적을 보여 주며 건물은 남아 있지 않다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 경주 포석정지",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333700010000",
      },
    ],
    endYear: 899,
  },
  {
    id: "korea-restored-namsandong-pagodas",
    subject: "korea",
    placeIds: ["kr-9cac2157f1bd"],
    title: "서로 다른 양식의 신라 쌍탑",
    period: "통일신라",
    startYear: 676,
    eraIds: ["k-unified-silla"],
    summary:
      "경주 남산동 동서 삼층석탑은 서로 다른 양식으로 마주 선 쌍탑이다. 동탑은 돌을 벽돌처럼 다듬어 쌓고, 서탑은 전형적인 삼층석탑 형식을 사용해 통일신라 석탑의 다양성을 보여 준다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 경주 남산동 동·서 삼층석탑",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123701240000",
      },
    ],
    endYear: 935,
  },
  {
    id: "korea-restored-gameunsa-pagodas",
    subject: "korea",
    placeIds: ["kr-dbef1a053624"],
    title: "문무왕의 뜻을 이은 감은사의 쌍탑",
    period: "통일신라, 682년",
    startYear: 682,
    eraIds: ["k-unified-silla"],
    summary:
      "감은사는 문무왕이 나라의 안정을 기원하며 짓기 시작해 아들 신문왕이 682년 완성한 절이다. 절터에 남은 동서 삼층석탑은 통일 직후 신라의 쌍탑 배치와 석조 기술을 보여 준다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 경주 감은사지 동·서 삼층석탑",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113701120000",
      },
    ],
    related: [
      {
        placeId: "kr-c2fe1ffb423e",
        targetEntryId: "story-korea-restored-munmu-tomb-kr-c2fe1ffb423e",
        reason:
          "문무대왕릉의 호국 전승과 감은사의 창건은 문무왕을 기리고 나라의 안정을 기원한 불교 신앙으로 이어진다.",
        fromPlaceIds: ["kr-dbef1a053624"],
      },
    ],
  },
  {
    id: "korea-restored-yongjang-pagoda",
    subject: "korea",
    placeIds: ["kr-276508faea83"],
    title: "산을 기단으로 삼은 신라 석탑",
    period: "통일신라 후기",
    startYear: 750,
    eraIds: ["k-unified-silla"],
    summary:
      "경주 용장사곡 삼층석탑은 높은 바위 위에 세워 산 전체가 탑의 받침처럼 보이게 한 석탑이다. 용장사 터에 남은 이 탑은 자연 지형을 활용한 통일신라 불교 건축을 보여 준다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 경주 남산 용장사곡 삼층석탑",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123701860000",
      },
    ],
    endYear: 935,
  },
  {
    id: "korea-restored-yongdu-danggan",
    subject: "korea",
    placeIds: ["kr-dc2217fc4814"],
    title: "고려 청주의 사찰과 지역 공동체",
    period: "고려, 962년",
    startYear: 962,
    eraIds: ["k-goryeo"],
    summary:
      "청주 용두사지 철당간은 절의 깃발을 달던 쇠기둥이다. 기둥에 새긴 글에는 962년의 건립 연대와 참여한 사람들의 이름이 남아 고려 초기 청주 지역의 불교 문화를 보여 준다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 청주 용두사지 철당간",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113300410000",
      },
    ],
  },
  {
    id: "korea-restored-icheondong-buddha",
    subject: "korea",
    placeIds: ["kr-b22fa37b3b12"],
    title: "바위와 돌머리로 만든 고려 불상",
    period: "고려",
    startYear: 918,
    eraIds: ["k-goryeo"],
    summary:
      "안동 이천동 마애여래입상은 바위에 몸을 새기고 별도로 만든 머리를 올린 거대한 불상이다. 지역의 지형과 돌을 활용한 고려시대 불상 조성 방식을 보여 준다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 안동 이천동 마애여래입상",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123701150000",
      },
    ],
    endYear: 1392,
  },
  {
    id: "korea-restored-changgyeonggung",
    subject: "korea",
    placeIds: ["kr-556d652da2f8"],
    title: "왕실 어른들을 위해 마련한 궁궐",
    period: "조선, 1484년",
    startYear: 1484,
    eraIds: ["k-joseon-early"],
    summary:
      "창경궁은 성종이 왕실의 세 대비를 모시기 위해 마련한 궁궐이다. 1484년 완성되어 창덕궁과 함께 왕실의 생활 공간을 이루었다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 창경궁",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1331101230000",
      },
    ],
  },
  {
    id: "korea-restored-paldalmun",
    subject: "korea",
    placeIds: ["kr-27c2834499ea"],
    title: "수원 화성의 남쪽 큰 문",
    period: "조선, 1796년",
    startYear: 1796,
    eraIds: ["k-joseon-late"],
    summary:
      "팔달문은 수원 화성의 남문으로 서울과 남쪽 지역을 잇는 길을 지키던 관문이다. 성문 바깥을 반원형 옹성으로 둘러 출입과 방어 기능을 함께 갖추었다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 수원 팔달문",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123104020000",
      },
    ],
    related: [
      {
        placeId: "kr-d18f7d3b24ac",
        targetEntryId: "story-korea-restored-gongsimdon-kr-d18f7d3b24ac",
        reason:
          "서북공심돈과 팔달문은 정조 때 건설한 수원 화성의 관측·방어와 출입을 맡은 시설이다.",
        fromPlaceIds: ["kr-27c2834499ea"],
      },
    ],
  },
  {
    id: "korea-restored-baedong-buddhas",
    subject: "korea",
    placeIds: ["kr-e7b46df31236"],
    title: "신라 초기 불교 조각의 모습",
    period: "삼국시대, 7세기",
    startYear: 600,
    eraIds: ["k-three-kingdoms"],
    summary:
      "경주 배동 석조여래삼존입상은 둥근 얼굴과 온화한 표정이 특징인 세 불상이다. 주변에 흩어져 있던 불상을 1923년 함께 세웠으며, 신라 초기 불교 조각의 모습을 전한다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 경주 배동 석조여래삼존입상",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1123700630000",
      },
    ],
    endYear: 699,
  },
  {
    id: "korea-restored-cheolgam-pagoda",
    subject: "korea",
    placeIds: ["kr-6867c80f9a0f"],
    title: "선종 승려를 기리는 신라 승탑",
    period: "통일신라, 9세기",
    startYear: 800,
    eraIds: ["k-unified-silla"],
    summary:
      "쌍봉사 철감선사탑은 선종 승려 철감선사의 사리를 모신 승탑이다. 팔각형 몸돌과 정교한 조각은 신라 말 선종의 성장과 높은 석조 기술을 보여 준다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 화순 쌍봉사 철감선사탑",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113600570000",
      },
    ],
    endYear: 899,
  },
  {
    id: "korea-restored-baegungyo",
    subject: "korea",
    placeIds: ["kr-b66ceee33052"],
    title: "불국사 불교 세계로 오르는 돌계단",
    period: "통일신라, 8세기",
    startYear: 700,
    eraIds: ["k-unified-silla"],
    summary:
      "백운교는 청운교와 이어져 불국사 대웅전 영역으로 올라가는 돌계단이다. 다리 형태로 꾸민 계단은 일상의 공간에서 부처의 세계로 들어가는 경계를 표현한다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 경주 불국사 청운교 및 백운교",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1113700230000",
      },
    ],
    endYear: 799,
    related: [
      {
        placeId: "kr-c80fa65a1d43",
        targetEntryId: "story-korea-restored-dabotap-kr-c80fa65a1d43",
        reason:
          "다보탑은 백운교와 청운교를 올라 들어가는 불국사 대웅전 앞마당에 서 있다.",
        fromPlaceIds: ["kr-b66ceee33052"],
      },
    ],
  },
  {
    id: "korea-restored-soswaewon",
    subject: "korea",
    placeIds: ["kr-2b45a1718a45"],
    title: "자연 속에 마련한 사림의 정원",
    period: "조선, 16세기",
    startYear: 1500,
    eraIds: ["k-joseon-early"],
    summary:
      "담양 소쇄원은 양산보가 조광조의 죽음 뒤 벼슬길을 떠나 조성한 정원이다. 계곡과 숲을 살린 공간에서 학문을 논하고 시를 지으며 조선 사림의 생활 문화를 남겼다.",
    sources: [
      {
        title: "국가유산청 국가유산포털 — 담양소쇄원",
        url: "https://www.heritage.go.kr/heri/cul/culSelectDetail.do?ccbaCpno=1333603040000",
      },
    ],
    endYear: 1599,
  },
  {
    id: "korea-restored-chungju-battle",
    subject: "korea",
    placeIds: ["kr-12ea9225d065"],
    title: "서울로 가는 길목의 탄금대 전투",
    period: "조선, 1592년",
    startYear: 1592,
    eraIds: ["k-joseon-early"],
    summary:
      "충주는 남한강과 육상 교통로가 만나는 군사적 요충지였다. 임진왜란 초기 신립이 이끈 조선군이 충주 탄금대에서 일본군에 패하면서 서울로 향하는 방어선이 무너졌다.",
    sources: [
      {
        title: "한국학중앙연구원 — 탄금대전투",
        url: "https://encykorea.aks.ac.kr/Article/E0058773",
      },
    ],
    related: [
      {
        placeId: "kr-a14b0e8e27dd",
        targetEntryId: "story-korea-restored-uiju-refuge-kr-a14b0e8e27dd",
        reason:
          "충주 탄금대 패전 뒤 서울 방어가 어려워지자 선조는 도성을 떠나 의주까지 피란했다.",
      },
      {
        placeId: "kr-8ae30bc3162c",
        targetEntryId: "story-korea-restored-dongnae-defense-kr-8ae30bc3162c",
        reason:
          "1592년 일본군은 동래를 함락한 뒤 북상했고, 충주 탄금대의 조선군 방어선도 무너뜨렸다.",
        fromPlaceIds: ["kr-12ea9225d065"],
      },
    ],
  },
  {
    id: "korea-restored-gangneung",
    subject: "korea",
    placeIds: ["kr-3554358133df"],
    title: "영동 지역을 다스린 강릉대도호부",
    period: "조선, 1413년",
    startYear: 1413,
    eraIds: ["k-joseon-early"],
    summary:
      "강릉은 고려 말에 대도호부로 승격된 뒤 조선에서도 영동 지역의 행정 중심지 역할을 했다. 1413년 팔도 체제가 마련되면서 강원도에 속했고, 강릉과 원주의 이름이 도명에 반영되었다.",
    sources: [
      {
        title: "한국학중앙연구원 — 강릉시",
        url: "https://encykorea.aks.ac.kr/Article/E0001105",
      },
    ],
    related: [
      {
        placeId: "kr-25f70fc39b69",
        targetEntryId: "story-korea-restored-wonju-kr-25f70fc39b69",
        reason:
          "강릉과 원주는 강원도의 이름을 이룬 두 주요 고을이며, 도의 감영은 원주에 있었다.",
      },
    ],
  },
  {
    id: "korea-restored-wonju",
    subject: "korea",
    placeIds: ["kr-25f70fc39b69"],
    title: "강원감영이 자리한 행정 중심지",
    period: "조선, 1395년",
    startYear: 1395,
    eraIds: ["k-joseon-early"],
    summary:
      "원주는 1395년 강원도가 설치된 뒤 강원감영이 자리한 도시이다. 관찰사가 머물며 도 안의 고을을 감독하는 행정 중심지 역할을 했다.",
    sources: [
      {
        title: "한국학중앙연구원 — 원주시",
        url: "https://encykorea.aks.ac.kr/Article/E0040842",
      },
    ],
    related: [
      {
        placeId: "kr-3554358133df",
        targetEntryId: "story-korea-restored-gangneung-kr-3554358133df",
        reason:
          "강릉과 원주는 강원도의 이름을 이룬 두 주요 고을이며, 도의 감영은 원주에 있었다.",
        fromPlaceIds: ["kr-25f70fc39b69"],
      },
    ],
  },
  {
    id: "korea-restored-namwon-battle",
    subject: "korea",
    placeIds: ["kr-3c130d976834"],
    title: "정유재란 때 남원성을 지킨 사람들",
    period: "조선, 1597년",
    startYear: 1597,
    eraIds: ["k-joseon-early"],
    summary:
      "남원은 정유재란 때 전라도로 진격하던 일본군과 조선·명 연합군이 맞선 도시이다. 1597년 남원성이 함락되면서 군인과 주민들이 큰 피해를 입었고, 희생자를 기리는 만인의총이 조성되었다.",
    sources: [
      {
        title: "한국학중앙연구원 — 남원 만인의총",
        url: "https://encykorea.aks.ac.kr/Article/E0017697",
      },
    ],
    related: [
      {
        placeId: "kr-a34472ffacdf",
        targetEntryId: "story-korea-myeongnyang-kr-a34472ffacdf",
        reason:
          "1597년 정유재란 때 육지의 남원성이 함락된 뒤, 바다에서는 조선 수군이 명량에서 승리했다.",
      },
    ],
  },
  {
    id: "korea-restored-uiju-refuge",
    subject: "korea",
    placeIds: ["kr-a14b0e8e27dd"],
    title: "선조가 피란한 국경 도시",
    period: "조선, 1592년",
    startYear: 1592,
    eraIds: ["k-joseon-early"],
    summary:
      "의주는 압록강을 건너 중국으로 이어지는 국경의 요충지였다. 임진왜란이 일어나자 선조가 의주로 피란해 목사의 관사에 머물렀으며, 전쟁 뒤 의주부로 승격되었다.",
    sources: [
      {
        title: "한국학중앙연구원 — 의주군",
        url: "https://encykorea.aks.ac.kr/Article/E0043403",
      },
    ],
    related: [
      {
        placeId: "kr-12ea9225d065",
        targetEntryId: "story-korea-restored-chungju-battle-kr-12ea9225d065",
        reason:
          "충주 탄금대 패전 뒤 서울 방어가 어려워지자 선조는 도성을 떠나 의주까지 피란했다.",
        fromPlaceIds: ["kr-a14b0e8e27dd"],
      },
    ],
  },
  {
    id: "korea-restored-dongnae-defense",
    subject: "korea",
    placeIds: ["kr-8ae30bc3162c"],
    title: "임진왜란 초기 동래의 항전",
    period: "조선, 1592년",
    startYear: 1592,
    eraIds: ["k-joseon-early"],
    summary:
      "동래는 일본과 오가는 길목이자 부산 지역의 행정 중심지였다. 1592년 임진왜란 초기에 부사 송상현과 군민이 동래성에서 일본군에 맞서 싸웠다.",
    sources: [
      {
        title: "한국학중앙연구원 — 동래부순절도",
        url: "https://encykorea.aks.ac.kr/Article/E0075665",
      },
    ],
    related: [
      {
        placeId: "kr-12ea9225d065",
        targetEntryId: "story-korea-restored-chungju-battle-kr-12ea9225d065",
        reason:
          "1592년 일본군은 동래를 함락한 뒤 북상했고, 충주 탄금대의 조선군 방어선도 무너뜨렸다.",
      },
    ],
  },
  {
    id: "korea-restored-hamhung",
    subject: "korea",
    placeIds: ["kr-93064df0b1a0"],
    title: "함경도 감영이 자리한 함흥",
    period: "조선 후기",
    startYear: 1600,
    eraIds: ["k-joseon-late"],
    summary:
      "함흥은 조선시대 함경도 관찰사가 머문 감영 소재지이다. 읍성 안의 선화당과 여러 관청을 중심으로 함경도 행정을 담당했으며, 옛 지도에도 관아와 성곽이 자세히 남아 있다.",
    sources: [
      {
        title: "한국학중앙연구원 — 함흥읍도",
        url: "https://encykorea.aks.ac.kr/Article/E0073100",
      },
    ],
  },
  {
    id: "korea-restored-yongin-battle",
    subject: "korea",
    placeIds: ["kr-1c0fc803af8f"],
    title: "서울을 되찾으려던 근왕군의 패전",
    period: "조선, 1592년",
    startYear: 1592,
    eraIds: ["k-joseon-early"],
    summary:
      "임진왜란 때 서울을 되찾으려 북상하던 조선의 삼도 근왕군은 용인 일대에서 일본군과 맞섰다. 1592년 6월 전투에서 패하면서 초기 서울 수복 계획이 좌절되었다.",
    sources: [
      {
        title: "한국학중앙연구원 — 용인전투",
        url: "https://encykorea.aks.ac.kr/Article/E0039643",
      },
    ],
    related: [
      {
        placeId: "kr-8081f9dbac47",
        targetEntryId: "story-korea-haengju-kr-8081f9dbac47",
        reason:
          "용인의 근왕군 패전 뒤에도 서울 수복 작전은 이어졌으며, 이듬해 권율이 행주에서 승리했다.",
      },
    ],
  },
  {
    id: "korea-restored-geumsan-battle",
    subject: "korea",
    placeIds: ["kr-70cb5c37802b"],
    title: "호남 진출을 막으려 한 의병 전투",
    period: "조선, 1592년",
    startYear: 1592,
    eraIds: ["k-joseon-early"],
    summary:
      "1592년 금산에서는 고경명과 조헌 등이 이끄는 의병이 일본군과 차례로 싸웠다. 호남으로 이어지는 길목을 지키려 한 전투에서 의병과 승병이 큰 희생을 치렀다.",
    sources: [
      {
        title: "한국학중앙연구원 — 금산전투",
        url: "https://encykorea.aks.ac.kr/Article/E0007820",
      },
    ],
    related: [
      {
        placeId: "jinju",
        targetEntryId: "story-korea-jinju-battle-jinju",
        reason:
          "금산의 의병 전투와 진주성 방어는 일본군의 전라도 진출을 막으려는 항전이었다.",
      },
    ],
  },
  {
    id: "korea-restored-tongyeong",
    subject: "korea",
    placeIds: ["kr-8e16145ff7fe"],
    title: "삼도 수군을 지휘한 통제영",
    period: "조선, 1604년",
    startYear: 1604,
    eraIds: ["k-joseon-late"],
    summary:
      "1604년 삼도수군통제영이 지금의 통영 시가지인 두룡포로 옮겨 왔다. 이곳에서 경상·전라·충청도의 수군을 지휘했으며, 통제영이라는 이름에서 통영이라는 지명이 비롯되었다.",
    sources: [
      {
        title: "한국학중앙연구원 — 통영시",
        url: "https://encykorea.aks.ac.kr/Article/E0059371",
      },
    ],
    related: [
      {
        placeId: "hansando",
        targetEntryId: "story-korea-hansando-hansando",
        reason:
          "한산도에 두었던 통제영은 전란 뒤 이동을 거쳐 1604년 통영 두룡포에 자리 잡았다.",
      },
    ],
  },
  {
    id: "korea-restored-ulsan-war",
    subject: "korea",
    placeIds: ["kr-b90ae636980c"],
    title: "정유재란의 거점이 된 울산",
    period: "조선, 1597~1598년",
    startYear: 1597,
    eraIds: ["k-joseon-early"],
    summary:
      "울산은 정유재란 때 일본군이 왜성을 쌓고 남해안의 거점으로 삼은 도시이다. 1597년 쌓은 울산왜성을 둘러싸고 조선·명 연합군과 일본군이 치열하게 맞섰다.",
    sources: [
      {
        title: "한국학중앙연구원 — 울산왜성",
        url: "https://encykorea.aks.ac.kr/Article/E0040485",
      },
    ],
  },
  {
    id: "korea-restored-yeosu-navy",
    subject: "korea",
    placeIds: ["kr-5ba7ff7609d3"],
    title: "전라좌수영과 임진왜란 수군의 근거지",
    period: "조선, 1592년",
    startYear: 1592,
    eraIds: ["k-joseon-early"],
    summary:
      "여수에는 전라좌수영이 자리해 전라도 동남부의 수군을 지휘했다. 임진왜란 때 이순신은 이 수군을 주축으로 함대를 이끌고 출전해 남해안에서 일본군의 진출을 막았다.",
    sources: [
      {
        title: "한국학중앙연구원 — 여수시",
        url: "https://encykorea.aks.ac.kr/Article/E0036392",
      },
    ],
    related: [
      {
        placeId: "kr-361994b9d007",
        targetEntryId: "story-korea-restored-okpo-kr-361994b9d007",
        reason:
          "여수의 전라좌수영에서 출동한 이순신 함대는 옥포에서 첫 승리를 거두었다.",
      },
    ],
  },
  {
    id: "korea-restored-sinuiju-rail",
    subject: "korea",
    placeIds: ["kr-aa778c35f854"],
    title: "압록강 철도 교통과 식민지 도시의 형성",
    period: "1905년",
    startYear: 1905,
    eraIds: ["k-opening"],
    summary:
      "신의주는 1905년 용산과 의주를 잇는 철도의 종착역이 들어서며 성장한 도시이다. 일본의 대륙 진출을 뒷받침하는 국경 교통 거점으로 개발되면서 기존 의주와 구별되는 도시가 형성되었다.",
    sources: [
      {
        title: "한국학중앙연구원 — 신의주시",
        url: "https://encykorea.aks.ac.kr/Article/E0033278",
      },
    ],
  },
  {
    id: "korea-restored-dodong",
    subject: "korea",
    placeIds: ["kr-224bcca1b128"],
    title: "김굉필의 학문을 기리는 서원",
    period: "조선, 1605년",
    startYear: 1605,
    eraIds: ["k-joseon-late"],
    summary:
      "달성 도동서원은 김굉필의 학문을 기리고 유생을 가르치기 위해 세운 서원이다. 강학 공간인 중정당을 앞에, 제향 공간인 사당을 뒤에 두어 조선 서원의 교육과 예법을 건축에 담았다.",
    sources: [
      {
        title: "한국학중앙연구원 — 달성 도동서원 중정당·사당·담장",
        url: "https://encykorea.aks.ac.kr/Article/E0015562",
      },
    ],
  },
  {
    id: "korea-restored-museong",
    subject: "korea",
    placeIds: ["kr-ebd4269a3868"],
    title: "최치원과 지역 선현을 기리는 서원",
    period: "조선, 1696년",
    startYear: 1696,
    eraIds: ["k-joseon-late"],
    summary:
      "정읍 무성서원은 최치원과 신잠 등을 기리고 지역 유생을 가르치던 곳이다. 1696년 무성이라는 이름을 사액받았으며, 조선 후기의 서원 철폐 때도 남았다.",
    sources: [
      {
        title: "한국학중앙연구원 — 정읍 무성서원",
        url: "https://encykorea.aks.ac.kr/Article/E0019088",
      },
    ],
  },
  {
    id: "korea-restored-balhae-junggyeong",
    subject: "korea",
    placeIds: ["kr-8ced6b94e17d"],
    title: "문왕 때 수도가 된 중경",
    period: "발해, 8세기",
    startYear: 740,
    eraIds: ["k-balhae"],
    summary:
      "중경 현덕부는 발해 문왕이 수도로 삼았던 도시로, 현재 중국 허룽의 서고성 유적으로 비정된다. 발해가 중앙과 지방의 통치 체제를 정비하던 시기의 정치 중심지이다.",
    sources: [
      {
        title: "국사편찬위원회 — 발해 중경 현덕부",
        url: "https://db.history.go.kr/diachronic/level.do?levelId=hn_034_0030_0030_0020",
      },
      {
        title: "국사편찬위원회 우리역사넷 — 발해의 5경과 교통로",
        url: "https://contents.history.go.kr/front/newEh/list.do?code=ganada&levelId=eh_r0117_0010",
      },
    ],
    endYear: 926,
    related: [
      {
        placeId: "sanggyeong",
        reason: "중경과 상경은 발해 문왕 때 수도가 옮겨 간 두 도시이다.",
        targetEntryId: "story-korea-balhae-sanggyeong-sanggyeong",
      },
    ],
  },
  {
    id: "korea-restored-balhae-donggyeong",
    subject: "korea",
    placeIds: ["kr-46ab0f59d5f6"],
    title: "일본으로 향하는 길목의 동경",
    period: "발해, 8~10세기",
    startYear: 785,
    eraIds: ["k-balhae"],
    summary:
      "동경 용원부는 발해가 한때 수도로 삼았으며 동해를 건너 일본과 교류하던 교통 거점이다. 현재 훈춘의 팔련성 유적으로 비정되며, 상경으로 다시 천도한 뒤에도 5경의 하나로 남았다.",
    sources: [
      {
        title: "국사편찬위원회 — 발해 동경 용원부",
        url: "https://db.history.go.kr/diachronic/level.do?levelId=hn_034_0030_0030_0030",
      },
      {
        title: "국사편찬위원회 우리역사넷 — 발해의 5경과 교통로",
        url: "https://contents.history.go.kr/front/newEh/list.do?code=ganada&levelId=eh_r0117_0010",
      },
    ],
    endYear: 926,
    related: [
      {
        placeId: "sanggyeong",
        reason:
          "발해는 상경에서 동경으로 수도를 옮겼다가 794년 다시 상경으로 돌아갔다.",
        targetEntryId: "story-korea-balhae-sanggyeong-sanggyeong",
      },
      {
        placeId: "kr-c27023f3c34a",
        targetEntryId: "story-korea-restored-balhae-namgyeong-kr-c27023f3c34a",
        reason:
          "남경과 동경은 발해가 동해 연안을 통해 다른 나라와 교류하던 교통 거점이다.",
        fromPlaceIds: ["kr-46ab0f59d5f6"],
      },
    ],
  },
  {
    id: "korea-restored-balhae-namgyeong",
    subject: "korea",
    placeIds: ["kr-c27023f3c34a"],
    title: "동해안 교통을 담당한 남경",
    period: "발해, 8~10세기",
    startYear: 750,
    eraIds: ["k-balhae"],
    summary:
      "남경 남해부는 발해의 5경 가운데 남쪽에 둔 지방 통치·교통 거점이다. 북청 청해토성으로 비정하는 견해가 있으며, 동해안을 따라 신라 및 일본과 오가는 길과 연결되었다.",
    sources: [
      {
        title: "국사편찬위원회 — 발해 남경 남해부",
        url: "https://db.history.go.kr/diachronic/level.do?levelId=hn_034_0030_0030_0040",
      },
      {
        title: "국사편찬위원회 우리역사넷 — 발해의 5경과 교통로",
        url: "https://contents.history.go.kr/front/newEh/list.do?code=ganada&levelId=eh_r0117_0010",
      },
    ],
    endYear: 926,
    related: [
      {
        placeId: "kr-46ab0f59d5f6",
        reason:
          "남경과 동경은 발해가 동해 연안을 통해 다른 나라와 교류하던 교통 거점이다.",
        targetEntryId: "story-korea-restored-balhae-donggyeong-kr-46ab0f59d5f6",
      },
    ],
  },
  {
    id: "korea-restored-balhae-seogyeong",
    subject: "korea",
    placeIds: ["kr-0a314eeac193"],
    title: "압록강을 따라 당으로 향한 서경",
    period: "발해, 8~10세기",
    startYear: 750,
    eraIds: ["k-balhae"],
    summary:
      "서경 압록부는 발해의 서쪽 교통을 담당한 5경의 하나로, 압록강 연안의 린장 일대로 비정된다. 당에 사신을 보내던 조공도와 연결되어 대외 교류의 거점 역할을 했다.",
    sources: [
      {
        title: "국사편찬위원회 — 발해 서경 압록부",
        url: "https://db.history.go.kr/diachronic/level.do?levelId=hn_034_0030_0030_0050",
      },
      {
        title: "국사편찬위원회 우리역사넷 — 발해의 5경과 교통로",
        url: "https://contents.history.go.kr/front/newEh/list.do?code=ganada&levelId=eh_r0117_0010",
      },
    ],
    endYear: 926,
    related: [
      {
        placeId: "sanggyeong",
        reason:
          "서경은 발해의 중심인 상경에서 당으로 사신을 보내는 서쪽 교통로의 거점이었다.",
        targetEntryId: "story-korea-balhae-sanggyeong-sanggyeong",
      },
    ],
  },
  {
    id: "korea-restored-okpo",
    subject: "korea",
    placeIds: ["kr-361994b9d007"],
    title: "이순신 함대의 첫 승전",
    period: "조선, 1592년",
    startYear: 1592,
    eraIds: ["k-joseon-early"],
    summary:
      "1592년 옥포 앞바다에서 이순신이 지휘한 조선 수군이 일본 함대를 공격해 승리했다. 옥포해전은 임진왜란에서 이순신 함대가 거둔 첫 승리로, 남해안 해상 방어를 이어 가는 출발점이 되었다.",
    sources: [
      {
        title: "한국학중앙연구원 — 임진왜란",
        url: "https://encykorea.aks.ac.kr/Article/E0047674",
      },
    ],
    related: [
      {
        placeId: "hansando",
        targetEntryId: "story-korea-hansando-hansando",
        reason:
          "옥포와 한산도는 1592년 조선 수군이 일본군의 해상 진출을 막으며 거둔 주요 승전지이다.",
      },
      {
        placeId: "kr-5ba7ff7609d3",
        targetEntryId: "story-korea-restored-yeosu-navy-kr-5ba7ff7609d3",
        reason:
          "여수의 전라좌수영에서 출동한 이순신 함대는 옥포에서 첫 승리를 거두었다.",
        fromPlaceIds: ["kr-361994b9d007"],
      },
    ],
  },
];

export const atlasKoreaRestoredStoryRelations: Record<
  string,
  NonNullable<AtlasHistoricalStory["related"]>
> = {
  "korea-hansando": [
    {
      placeId: "kr-a34472ffacdf",
      targetEntryId: "story-korea-myeongnyang-kr-a34472ffacdf",
      reason:
        "한산도에서 승리한 조선 수군은 정유재란의 칠천량 패전 뒤 재정비되어 명량에서 다시 승리했다.",
    },
    {
      placeId: "kr-8e16145ff7fe",
      targetEntryId: "story-korea-restored-tongyeong-kr-8e16145ff7fe",
      reason:
        "한산도에 두었던 통제영은 전란 뒤 이동을 거쳐 1604년 통영 두룡포에 자리 잡았다.",
      fromPlaceIds: ["hansando"],
    },
    {
      placeId: "kr-361994b9d007",
      targetEntryId: "story-korea-restored-okpo-kr-361994b9d007",
      reason:
        "옥포와 한산도는 1592년 조선 수군이 일본군의 해상 진출을 막으며 거둔 주요 승전지이다.",
      fromPlaceIds: ["hansando"],
    },
  ],
  "korea-myeongnyang": [
    {
      placeId: "kr-f8f6a36df2ea",
      targetEntryId: "story-korea-noryang-kr-f8f6a36df2ea",
      reason:
        "명량에서 해상 방어를 이어 간 이순신은 이듬해 노량에서 철수하는 일본군과 마지막 큰 해전을 벌였다.",
    },
    {
      placeId: "hansando",
      targetEntryId: "story-korea-hansando-hansando",
      reason:
        "한산도에서 승리한 조선 수군은 정유재란의 칠천량 패전 뒤 재정비되어 명량에서 다시 승리했다.",
    },
    {
      placeId: "kr-3c130d976834",
      targetEntryId: "story-korea-restored-namwon-battle-kr-3c130d976834",
      reason:
        "1597년 정유재란 때 육지의 남원성이 함락된 뒤, 바다에서는 조선 수군이 명량에서 승리했다.",
      fromPlaceIds: ["kr-a34472ffacdf"],
    },
  ],
  "korea-haengju": [
    {
      placeId: "jinju",
      targetEntryId: "story-korea-jinju-battle-jinju",
      reason:
        "진주성 전투와 행주대첩은 조선군과 주민이 성을 지키며 일본군의 공격을 막아 낸 승리이다.",
      fromPlaceIds: ["kr-388386c5b233", "kr-8081f9dbac47"],
    },
    {
      placeId: "kr-1c0fc803af8f",
      targetEntryId: "story-korea-restored-yongin-battle-kr-1c0fc803af8f",
      reason:
        "용인의 근왕군 패전 뒤에도 서울 수복 작전은 이어졌으며, 이듬해 권율이 행주에서 승리했다.",
      fromPlaceIds: ["kr-8081f9dbac47"],
    },
  ],
  "korea-noryang": [
    {
      placeId: "kr-a34472ffacdf",
      targetEntryId: "story-korea-myeongnyang-kr-a34472ffacdf",
      reason:
        "명량에서 해상 방어를 이어 간 이순신은 이듬해 노량에서 철수하는 일본군과 마지막 큰 해전을 벌였다.",
    },
  ],
  "korea-jinju-battle": [
    {
      placeId: "kr-8081f9dbac47",
      targetEntryId: "story-korea-haengju-kr-8081f9dbac47",
      reason:
        "진주성 전투와 행주대첩은 조선군과 주민이 성을 지키며 일본군의 공격을 막아 낸 승리이다.",
      fromPlaceIds: ["jinju", "kr-6a142297546f"],
    },
    {
      placeId: "kr-70cb5c37802b",
      targetEntryId: "story-korea-restored-geumsan-battle-kr-70cb5c37802b",
      reason:
        "금산의 의병 전투와 진주성 방어는 일본군의 전라도 진출을 막으려는 항전이었다.",
      fromPlaceIds: ["jinju"],
    },
  ],
  "korea-byeongsan": [
    {
      placeId: "kr-442fb975dab0",
      targetEntryId: "story-korea-restored-mandaeru-kr-442fb975dab0",
      reason:
        "만대루는 유성룡을 기리는 병산서원의 유생들이 함께 모이던 누각이다.",
      fromPlaceIds: ["kr-b6bcc939acd8"],
    },
  ],
  "korea-dosan": [
    {
      placeId: "kr-254b01e6cf36",
      targetEntryId: "story-korea-restored-jeongyodang-kr-254b01e6cf36",
      reason:
        "전교당은 이황을 기리는 도산서원에서 유생을 가르치던 중심 강당이다.",
      fromPlaceIds: ["kr-c3b00a1be92c"],
    },
  ],
  "korea-balhae-sanggyeong": [
    {
      placeId: "kr-8ced6b94e17d",
      targetEntryId: "story-korea-restored-balhae-junggyeong-kr-8ced6b94e17d",
      reason: "중경과 상경은 발해 문왕 때 수도가 옮겨 간 두 도시이다.",
      fromPlaceIds: ["sanggyeong"],
    },
    {
      placeId: "kr-46ab0f59d5f6",
      targetEntryId: "story-korea-restored-balhae-donggyeong-kr-46ab0f59d5f6",
      reason:
        "발해는 상경에서 동경으로 수도를 옮겼다가 794년 다시 상경으로 돌아갔다.",
      fromPlaceIds: ["sanggyeong"],
    },
    {
      placeId: "kr-0a314eeac193",
      targetEntryId: "story-korea-restored-balhae-seogyeong-kr-0a314eeac193",
      reason:
        "서경은 발해의 중심인 상경에서 당으로 사신을 보내는 서쪽 교통로의 거점이었다.",
      fromPlaceIds: ["sanggyeong"],
    },
  ],
};

export const atlasKoreaRestoredRegionOverrides: Record<string, string[]> = {
  "kr-42182b7d5100": ["gyeongsang"],
  "kr-41355b2ef6ea": ["gyeongsang"],
  "kr-43c62744a4f4": ["gyeongsang"],
  "kr-77b320dc1ed4": ["chungcheong"],
  "kr-fb038027b398": ["chungcheong"],
  "kr-20b36ef183a5": ["gyeonggi"],
  "kr-49b31c53bf7a": ["chungcheong"],
  "kr-ef0b3d79916d": ["gyeonggi"],
  "kr-a76f02643cdd": ["gyeongsang"],
  "kr-cc53fabf10ab": ["chungcheong"],
  "kr-74eb96d6661b": ["chungcheong"],
  "kr-84e61b3eab9a": ["gyeongsang"],
  "kr-6f68810a2fb8": ["gyeongsang"],
  "kr-6bae6070884f": ["gyeongsang"],
  "kr-507555e467bd": ["gyeongsang"],
  "kr-c80fa65a1d43": ["gyeongsang"],
  "kr-699f2c61ea69": ["gyeongsang"],
  "kr-feb96c06aa14": ["jeolla"],
  "kr-1ed4b496dccb": ["gyeonggi"],
  "kr-6185d7d2721d": ["gyeongsang"],
  "kr-b6bcc939acd8": ["gyeongsang"],
  "kr-a38fd43eddde": ["gyeonggi"],
  "kr-442fb975dab0": ["gyeongsang"],
  "kr-c3b00a1be92c": ["gyeongsang"],
  "kr-862bd72c7740": ["gyeongsang"],
  "kr-33b188925aa0": ["gyeongsang"],
  "kr-10bb079a880b": ["gyeongsang"],
  "kr-333194fa9ac9": ["jeolla"],
  "kr-cd245446c0da": ["chungcheong"],
  "kr-93464ab4266a": ["gyeonggi"],
  "kr-6b7944097ae7": ["gyeonggi"],
  "kr-ddd7324d743e": ["gyeonggi"],
  "kr-6a142297546f": ["gyeongsang"],
  "kr-08bd6fdf1ad4": ["gyeonggi"],
  "kr-729119e6b9f6": ["gyeonggi"],
  "kr-21cbecd852a8": ["gyeonggi"],
  "kr-f408a789b2b0": ["gyeonggi"],
  "kr-18b733ab896a": ["gyeonggi"],
  "kr-bcf851da163c": ["jeolla"],
  "kr-a52af3e9391a": ["gyeongsang"],
  "kr-667444e22c99": ["gyeongsang"],
  "kr-c2fe1ffb423e": ["gyeongsang"],
  "kr-6ae2d4695ab4": ["gyeongsang"],
  "kr-66c7b07aacdd": ["gyeongsang"],
  "kr-254b01e6cf36": ["gyeongsang"],
  "kr-ed8ad25e7791": ["gyeonggi"],
  "kr-d18f7d3b24ac": ["gyeonggi"],
  "kr-2ad7f0aa1fec": ["chungcheong"],
  "kr-50dba735c9cb": ["gyeonggi"],
  "kr-ef4605ebde38": ["gyeonggi"],
  "kr-55ca4e33a315": ["jeolla"],
  "kr-6e8e468357ba": ["chungcheong"],
  "kr-ab144d954c89": ["gyeongsang"],
  "kr-a5382a629d33": ["jeolla"],
  "kr-811a130012b1": ["gyeongsang"],
  "kr-9cac2157f1bd": ["gyeongsang"],
  "kr-3a0fd059efbe": ["gyeongsang"],
  "kr-dbef1a053624": ["gyeongsang"],
  "kr-276508faea83": ["gyeongsang"],
  "kr-dc2217fc4814": ["chungcheong"],
  "kr-b22fa37b3b12": ["gyeongsang"],
  "kr-d4c3c667b774": ["gangwon"],
  "kr-f86f6fabbb8e": ["gyeongsang"],
  "kr-c4a88522c0dc": ["chungcheong"],
  "kr-556d652da2f8": ["gyeonggi"],
  "kr-44484ff2c209": ["gyeonggi"],
  "kr-8081f9dbac47": ["gyeonggi"],
  "kr-27c2834499ea": ["gyeonggi"],
  "kr-dcd62974da10": ["gyeonggi"],
  "kr-2261bcc0d80e": ["gyeonggi"],
  "kr-296dbe381817": ["chungcheong"],
  "kr-e7b46df31236": ["gyeongsang"],
  "kr-6867c80f9a0f": ["jeolla"],
  "kr-b66ceee33052": ["gyeongsang"],
  "kr-2b45a1718a45": ["jeolla"],
  "kr-12968d0538d3": ["gyeongsang"],
  "kr-f5c8b61aaadc": ["jeolla"],
  "kr-09a5e4baa822": ["jeolla"],
  sanggyeong: ["outside-korea"],
  "kr-8ced6b94e17d": ["outside-korea"],
  "kr-46ab0f59d5f6": ["outside-korea"],
  "kr-c27023f3c34a": ["outside-korea"],
  "kr-0a314eeac193": ["outside-korea"],
  "kr-a34472ffacdf": ["jeolla"],
  "kr-f8f6a36df2ea": ["gyeongsang"],
  "kr-361994b9d007": ["gyeongsang"],
};
