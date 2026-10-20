import type { AtlasGeographicReference } from "../lib/historyAtlasGeographicReferences";

/** Reviewed against institutional sources on 2026-10-20.
 * Existing place IDs/verified representative points are retained. New points
 * are approximate locators, not surveyed palace sites or historic boundaries.
 * evidenceBounds are review envelopes and must never be drawn as city walls.
 */
export const atlasEastAsiaCityReferences: AtlasGeographicReference[] = [
  {
    place: {
      id: "karakorum",
      name: "카라코룸",
      modernName: "몽골 하르호린 인근 카라코룸 유적",
      aliases: ["하르호린", "카라코룸"],
      kind: "settlement",
      coordinates: [102.82, 47.2],
      locationNote:
        "오르혼 계곡의 카라코룸 유적 일대를 나타낸 대표점이다. 현대 하르호린 시가지나 개별 궁궐의 정확한 위치를 뜻하지 않는다.",
    },
    definition:
      "카라코룸은 몽골 중부 오르혼 계곡에 남아 있는 몽골 제국의 옛 수도 유적이다.",
    facts: [
      {
        label: "위치",
        value: "몽골 중부, 하르호린 인근의 오르혼 계곡에 있다.",
      },
      {
        label: "역사 지리",
        value:
          "유목 지역의 정치·교역 중심지였으며, 오르혼 계곡 문화경관에 포함된다.",
      },
    ],
    sources: [
      {
        title: "UNESCO · Orkhon Valley Cultural Landscape",
        url: "https://whc.unesco.org/en/list/1081/",
      },
    ],
    evidenceBounds: [102.7, 47.1, 102.95, 47.35],
  },
  {
    place: {
      id: "kr-da2cc50b7f4d",
      name: "하얼빈",
      modernName: "중국 헤이룽장성 하얼빈",
      aliases: ["합이빈", "哈尔滨", "Harbin"],
      kind: "settlement",
      coordinates: [126.6, 45.8],
      locationNote:
        "쑹화강 연안 하얼빈 시가지의 근사 대표점이다. 하얼빈역과 아청구 남쪽의 금 상경회령부 유적은 각각 별도 장소다.",
    },
    definition:
      "하얼빈은 중국 동북부 헤이룽장성의 중심 도시로, 쑹화강을 따라 시가지가 발달했다.",
    facts: [
      { label: "위치", value: "헤이룽장성에 있으며 쑹화강이 시가지를 지난다." },
      {
        label: "장소 구분",
        value:
          "금의 상경회령부 유적은 현재 하얼빈시 아청구 남쪽에 있다. 현재의 중심 시가지와 같은 지점이 아니다.",
      },
    ],
    sources: [
      {
        title: "헤이룽장성 · 성 개요",
        url: "https://www.hlj.gov.cn/hlj/c108476/202005/c00_30550923.shtml",
      },
      {
        title: "헤이룽장성 · 쑹화강 하얼빈 구간",
        url: "https://www.hlj.gov.cn/hljapp/c116058/202404/c00_31724125.shtml",
      },
      {
        title: "중국 최고인민검찰원 · 아청구 금 상경회령부 유적",
        url: "https://www.spp.gov.cn/spp/zdgz/202105/t20210506_517318.shtml",
      },
    ],
    evidenceBounds: [126.3, 45.5, 126.95, 46],
  },
  {
    place: {
      id: "kr-b4d33990a194",
      name: "창춘",
      modernName: "중국 지린성 창춘",
      aliases: ["장춘", "신경", "新京", "长春", "Changchun"],
      kind: "settlement",
      coordinates: [125.3, 43.9],
      locationNote:
        "창춘 시가지의 근사 대표점이다. 관성자역이나 만주국 궁전 같은 개별 시설의 정확한 위치를 뜻하지 않는다.",
    },
    definition:
      "창춘은 중국 지린성의 중심 도시다. 일제의 만주국 지배 시기에는 신경이라는 이름으로 불렸다.",
    facts: [
      {
        label: "위치",
        value: "중국 동북부 지린성에 있으며 이퉁강이 시가지를 지난다.",
      },
      {
        label: "옛 이름",
        value:
          "1932년 일본의 괴뢰국인 만주국이 이곳을 수도로 정하면서 신경으로 이름을 바꾸었다.",
      },
    ],
    sources: [
      {
        title: "지린성 · 역사와 인문",
        url: "https://www.jl.gov.cn/shengqing/lsrw/",
      },
      {
        title: "지린성 지방지편찬위원회 · 이퉁강",
        url: "https://dfz.jl.gov.cn/zsjl/201805/t20180514_5216584.html",
      },
    ],
    evidenceBounds: [125.1, 43.7, 125.6, 44.1],
  },
  {
    place: {
      id: "beijing",
      name: "베이징",
      modernName: "중국 베이징",
      aliases: ["북경", "대도", "연경", "중도"],
      kind: "settlement",
      coordinates: [116.4, 39.9],
      locationNote:
        "현재 베이징 중심부의 대표점이다. 요의 남경, 금의 중도, 원의 대도와 명·청 도성은 시대별 위치와 범위가 다르다.",
    },
    definition:
      "베이징은 중국 화북 지역의 도시이자 현재 수도로, 원·명·청을 거치며 도성과 궁궐이 발달했다.",
    facts: [
      {
        label: "역사 지리",
        value: "요의 남경과 금의 중도, 원의 대도가 베이징 일대에 있었다.",
      },
      {
        label: "장소 구분",
        value:
          "요의 중경은 현재 내몽골 닝청에 있었다. 베이징의 요 남경과 다른 도성이다.",
      },
    ],
    sources: [
      {
        title: "베이징시 인민대표대회 · 베이징 도성의 역사",
        url: "https://www.bjrd.gov.cn/fwhd/bjrdzz/2025n/d2q/bjsq02/202503/t20250318_4037622.html",
      },
      {
        title: "베이징시 · 중심축의 역사",
        url: "https://english.beijing.gov.cn/specials/centralaxis/thepastandpresentcentralaxis/",
      },
    ],
    evidenceBounds: [116.1, 39.7, 116.7, 40.2],
  },
  {
    place: {
      id: "world-9ab745ec51b2",
      name: "평성",
      modernName: "중국 산시성 다퉁 일대",
      aliases: ["다퉁", "대동", "平城", "Datong"],
      kind: "settlement",
      coordinates: [113.3, 40.1],
      locationNote:
        "북위 평성이 있었던 다퉁 일대의 근사 대표점이다. 북위 궁성의 발굴 지점이나 내몽골의 성락을 나타내지 않는다.",
    },
    definition:
      "평성은 오늘날 중국 산시성 다퉁 일대의 옛 지명으로, 북위가 수도를 두었던 곳이다.",
    facts: [
      {
        label: "역사 지리",
        value:
          "북위는 398년 성락에서 평성으로 수도를 옮겼으며, 494년에는 뤄양으로 옮겼다.",
      },
      {
        label: "장소 구분",
        value:
          "성락과 평성은 서로 다른 도시다. 평성을 성락의 다른 이름으로 보지 않는다.",
      },
    ],
    sources: [
      {
        title: "다퉁시 · 행정구역과 도성의 역사",
        url: "https://www.dt.gov.cn/dtszf/sqgllssy/202510/fdd071b890bb464c841cd2fb5449fe13.shtml",
      },
      {
        title: "다퉁시 평성구 · 역사 연혁",
        url: "https://www.pingcheng.gov.cn/pcqrmzfz/sqglrkfy/202007/2117d2b35671498eb5d7900024185e0a.shtml",
      },
    ],
    evidenceBounds: [113.1, 39.9, 113.5, 40.3],
  },
  {
    place: {
      id: "eastasia-ye",
      name: "업",
      modernName: "중국 허베이성 린장현 업성 유적 일대",
      aliases: ["업성", "鄴", "邺城", "예청", "Yecheng"],
      kind: "settlement",
      coordinates: [114.4, 36.3],
      locationNote:
        "린장현 남서쪽 업성 유적 일대의 근사 대표점이다. 업북성·업남성의 성문이나 현대 안양 시가지의 정확한 위치를 뜻하지 않는다.",
    },
    definition:
      "업은 중국 허베이성 린장현에 유적이 남아 있는 옛 도성이다. 안양과 인접한 지역에서 북조 시대의 정치·문화 중심지로 발전했다.",
    facts: [
      {
        label: "유적",
        value:
          "업북성과 업남성의 유적이 남아 있으며, 시대에 따라 도성의 배치가 달라졌다.",
      },
      {
        label: "장소 구분",
        value:
          "업성은 현재 린장현에 있다. 580년 업성이 파괴된 뒤 상주의 치소가 안양으로 옮겨져 두 지역의 역사가 이어졌다.",
      },
    ],
    sources: [
      {
        title: "허베이성 문물고고연구원 · 업성 유적",
        url: "https://www.hbswwkg.com/2021-04/16/content_8466360.html",
      },
      {
        title: "안양시 문물고고연구원 · 업성과 안양의 역사 지리",
        url: "https://www.ayswwkgyjy.cn/index.php/newsinfo/336.html",
      },
    ],
    evidenceBounds: [114.3, 36.15, 114.6, 36.4],
  },
  {
    place: {
      id: "world-70ed25aa6908",
      name: "뤄양",
      modernName: "중국 허난성 뤄양",
      aliases: ["낙양", "락양", "洛阳", "Luoyang"],
      kind: "settlement",
      coordinates: [112.5, 34.7],
      locationNote:
        "뤄양 시가지 일대의 근사 대표점이다. 동주 왕성, 한·위 뤄양성, 수·당 뤄양성의 유적 위치와 경계는 서로 다르다.",
    },
    definition:
      "뤄양은 중국 허난성 서부 뤄허 유역의 도시다. 여러 왕조의 수도가 이 일대에 있었으며 도성은 시대마다 새로 조성되거나 옮겨졌다.",
    facts: [
      {
        label: "위치",
        value: "허난성 서부, 뤄허를 중심으로 한 분지에 자리한다.",
      },
      {
        label: "도성 구분",
        value:
          "수·당 뤄양성은 한·위 뤄양성보다 서쪽에 새로 지어졌다. 두 도성을 같은 유적 위치로 볼 수 없다.",
      },
    ],
    sources: [
      {
        title: "뤄양시 · 역사 연혁",
        url: "https://www.ly.gov.cn/2013/06-24/74500.html",
      },
      { title: "뤄양시 · 도시와 유산", url: "https://m.ly.gov.cn/mlly/" },
    ],
    evidenceBounds: [112.2, 34.5, 112.8, 34.9],
  },
  {
    place: {
      id: "xian",
      name: "장안",
      modernName: "중국 시안 일대",
      aliases: ["시안", "서안", "대흥", "장안"],
      kind: "settlement",
      coordinates: [108.94, 34.27],
      locationNote:
        "현재 시안 일대의 대표점이다. 한·당의 장안성과 현대 시가지의 범위는 다르며, 진의 함양 유적을 이 점에 합치지 않는다.",
    },
    definition:
      "장안은 오늘날 중국 시안 일대에 있던 고대 수도다. 수의 대흥성과 이를 이어받은 당의 장안성은 한의 장안성과 다른 자리에 조성되었다.",
    facts: [
      { label: "현재 위치", value: "중국 산시성 시안 일대에 해당한다." },
      {
        label: "도성 구분",
        value:
          "진의 함양, 한의 장안, 수·당의 장안은 서로 다른 도성 유적이다. 시안이라는 현대 도시명만으로 같은 지점에 합칠 수 없다.",
      },
    ],
    sources: [
      {
        title: "시안시 지방지판공실 · 수 대흥성·당 장안성 유적",
        url: "https://xadfz.xa.gov.cn/xadq/rwxa/1960625284585664514.html",
      },
      {
        title: "시안시 문물국 · 청룡사와 한·수·당 도성의 위치",
        url: "https://wwj.xa.gov.cn/xwzx/tzgg/1902288108237918209.html",
      },
      {
        title: "시셴신구 · 진 함양성 유적과 진한신성",
        url: "https://www.xixianxinqu.gov.cn/xwzx/ztzl/yjhj/st/1888786427177082882.html",
      },
    ],
    evidenceBounds: [108.7, 34.1, 109.1, 34.5],
  },
  {
    place: {
      id: "eastasia-xuchang",
      name: "허창",
      modernName: "중국 허난성 쉬창",
      aliases: ["쉬창", "허도", "许昌", "許昌", "Xuchang"],
      kind: "settlement",
      coordinates: [113.9, 34],
      locationNote:
        "오늘날 쉬창 시가지 일대의 근사 대표점이다. 후한 말의 허도 유적은 젠안구 장판진에 따로 남아 있으며 이 점은 유적의 정밀 좌표가 아니다.",
    },
    definition:
      "허창은 중국 허난성 중부의 도시다. 후한 말 헌제의 조정이 옮겨 온 허도 유적이 오늘날 쉬창시 젠안구에 남아 있다.",
    facts: [
      {
        label: "현재 위치",
        value: "허난성 중부에 있으며 현대 중국어 발음으로는 쉬창이라 부른다.",
      },
      {
        label: "유적 위치",
        value:
          "한·위 허도 고성은 장판진 일대에 있다. 현대 시가지와 옛 도성의 위치를 구분해서 본다.",
      },
    ],
    sources: [
      {
        title: "쉬창시 · 위치",
        url: "https://www.xuchang.gov.cn/zjxc/005001/005001001/20170526/b5e2bf5b-20d4-46ec-9ce7-f3abc93aeea3.html",
      },
      {
        title: "쉬창시 · 한·위 허도 고성 고고 조사",
        url: "https://www.xuchang.gov.cn/zjxc/005010/20251205/49e3c6e9-df14-4442-a9d5-10c356cc2676.html",
      },
    ],
    evidenceBounds: [113.6, 33.8, 114.2, 34.2],
  },
  {
    place: {
      id: "kaifeng",
      name: "카이펑",
      modernName: "중국 허난성 카이펑",
      aliases: ["개봉", "변경", "카이펑"],
      kind: "settlement",
      coordinates: [114.31, 34.8],
      locationNote:
        "현재 카이펑 시가지의 대표점이다. 북송 도성의 성벽이나 개별 유적의 정밀 위치를 뜻하지 않는다.",
    },
    definition:
      "카이펑은 중국 허난성 황허 인근의 도시다. 운하와 하천 교통이 모이는 북송의 수도로 성장했다.",
    facts: [
      {
        label: "지리",
        value: "황허와 연결되는 하천·운하의 교통망이 도시 발전에 중요했다.",
      },
      {
        label: "옛 이름",
        value: "북송의 동경·변경으로 알려졌으며, 금에서는 남경으로 불렸다.",
      },
    ],
    sources: [
      {
        title: "카이펑시 · 황허와 도시의 역사",
        url: "https://www.kaifeng.gov.cn/kfsrmzfwz/hhwh/pc/content/content_1737108161932075008.html",
      },
      {
        title: "베이징시 인민대표대회 · 금의 중도와 남경",
        url: "https://www.bjrd.gov.cn/fwhd/bjrdzz/2025n/d2q/bjsq02/202503/t20250318_4037622.html",
      },
    ],
    evidenceBounds: [114.1, 34.6, 114.6, 35],
  },
  {
    place: {
      id: "kr-997ff32e91fa",
      name: "쉬저우",
      modernName: "중국 장쑤성 쉬저우",
      aliases: ["서주", "팽성", "徐州", "彭城", "Xuzhou"],
      kind: "settlement",
      coordinates: [117.2, 34.3],
      locationNote:
        "쉬저우의 옛 중심 시가지인 팽성 일대를 나타낸 근사 대표점이다. 역사상 광역 행정구역 서주의 전체 범위나 모든 시대의 주 치소를 뜻하지 않는다.",
    },
    definition:
      "쉬저우는 중국 장쑤성 북부의 도시다. 옛 도심은 팽성이라는 이름으로 알려져 있으며, 역사상의 광역 행정구역 서주와는 범위를 구분해야 한다.",
    facts: [
      {
        label: "옛 이름",
        value: "팽성은 오늘날 쉬저우 시가지에 해당하는 역사 지명이다.",
      },
      {
        label: "범위",
        value:
          "이 지도에서는 도시 쉬저우를 표시한다. 한대의 서주와 같은 넓은 행정구역 전체를 한 점으로 나타낸 것은 아니다.",
      },
    ],
    sources: [
      {
        title: "법고문리학원 지명규범자료고 · 팽성",
        url: "https://authority.dila.edu.tw/place/search.php?code=PL000000009523",
      },
      {
        title: "장쑤성 정무서비스 · 쉬저우 팽성가도",
        url: "https://ylqpc.jszwfw.gov.cn/index.html",
      },
    ],
    evidenceBounds: [117, 34.1, 117.5, 34.5],
  },
  {
    place: {
      id: "nanjing",
      name: "난징",
      modernName: "중국 장쑤성 난징",
      aliases: ["남경", "금릉", "건강", "건업"],
      kind: "settlement",
      coordinates: [118.8, 32.06],
      locationNote:
        "현재 난징 시가지의 대표점이다. 시대별 도성과 궁궐은 범위가 다르며, 요의 남경인 베이징과도 구분한다.",
    },
    definition:
      "난징은 창장 하류에 있는 중국 장쑤성의 도시다. 여러 왕조의 수도가 들어섰으며 건업·건강·금릉 등의 이름과 관련된다.",
    facts: [
      { label: "위치", value: "장쑤성 서남부의 창장 하류에 자리한다." },
      {
        label: "이름 구분",
        value:
          "현재 도시 난징과 요나라의 남경은 서로 다른 곳이다. 요의 남경은 베이징 일대에 있었다.",
      },
    ],
    sources: [
      {
        title: "난징시 · 도시 개요와 역사",
        url: "https://www.nanjing.gov.cn/zjnj/",
      },
      {
        title: "베이징시 · 베이징과 난징 명칭의 역사",
        url: "https://www.beijing.gov.cn/renwen/sy/whkb/201907/t20190715_1866582.html",
      },
    ],
    evidenceBounds: [118.6, 31.85, 119, 32.3],
  },
  {
    place: {
      id: "shanghai",
      name: "상하이",
      modernName: "중국 상하이",
      aliases: ["상해", "상하이"],
      kind: "settlement",
      coordinates: [121.47, 31.23],
      locationNote:
        "현재 상하이 중심 시가지의 대표점이다. 조계지, 임시정부 청사와 훙커우공원은 각각 범위와 위치가 다른 장소다.",
    },
    definition:
      "상하이는 중국 동부 해안의 창장 하구 지역에 있는 도시다. 황푸강을 따라 시가지와 항만이 발달했다.",
    facts: [
      {
        label: "위치",
        value: "북쪽으로 창장, 동쪽으로 동중국해, 남쪽으로 항저우만과 접한다.",
      },
      {
        label: "도시 범위",
        value:
          "상하이라는 도시와 근대의 조계지, 개별 역사 유적은 같은 범위가 아니다.",
      },
    ],
    sources: [
      {
        title: "상하이시 · 지리",
        url: "https://english.shanghai.gov.cn/en-Overview/20231209/705180b43f794c1ca43f4d1ddaa049a2.html",
      },
      {
        title: "상하이시 · 행정구역과 황푸강",
        url: "https://english.shanghai.gov.cn/en-AdministrativeDistricts/index.html",
      },
    ],
    evidenceBounds: [121.2, 31, 121.8, 31.5],
  },
  {
    place: {
      id: "world-872972e9a3dc",
      name: "항저우",
      modernName: "중국 저장성 항저우",
      aliases: ["항주", "임안", "린안", "杭州", "临安"],
      kind: "settlement",
      coordinates: [120.16142, 30.29365],
      locationNote:
        "현재 항저우 시가지의 대표점이다. 남송 임안성의 성벽·궁궐이나 현재 항저우 서쪽의 린안구를 나타내는 정밀 좌표가 아니다.",
    },
    definition:
      "항저우는 중국 저장성의 도시로, 남송의 수도였던 임안이 현재 항저우 중심부 일대에 있었다.",
    facts: [
      {
        label: "옛 이름",
        value: "남송은 항저우를 임안부로 삼았으며 도성과 궁궐을 조성했다.",
      },
      {
        label: "장소 구분",
        value:
          "남송의 도성 임안과 현재의 행정구역 린안구는 범위가 다르다. 현재 린안구에는 당시 임안부 관할의 별도 현들이 포함된다.",
      },
    ],
    sources: [
      {
        title: "항저우시 위항구 · 남송 임안성과 현대 행정구역",
        url: "https://www.yuhang.gov.cn/art/2022/9/20/art_1532136_59025574.html",
      },
      {
        title: "항저우시 · 린안구 설치",
        url: "https://zfgb.hangzhou.gov.cn/10/105220253/t120220253054/519374.shtml",
      },
    ],
    evidenceBounds: [120, 30.1, 120.4, 30.5],
  },
  {
    place: {
      id: "eastasia-jiangling",
      name: "장링",
      modernName: "중국 후베이성 징저우 고성 일대",
      aliases: ["강릉", "장링성", "江陵", "Jiangling"],
      kind: "settlement",
      coordinates: [112.2, 30.35],
      locationNote:
        "역사상 강릉성에 해당하는 징저우 고성 일대의 근사 대표점이다. 오늘날 장링현의 현청 소재지 하오쉐와는 다른 장소다.",
    },
    definition:
      "장링은 창장 중류의 징저우 고성 일대에 해당하는 역사 지명이다. 한국 한자음으로는 강릉이라고 읽는다.",
    facts: [
      {
        label: "역사 지리",
        value:
          "남조 양과 서량 등 여러 정권이 수도를 두었던 강릉성은 오늘날 징저우 고성 일대에 해당한다.",
      },
      {
        label: "장소 구분",
        value:
          "역사상의 강릉성과 현대 행정구역 장링현은 범위가 다르다. 지도는 옛 도성 일대를 표시한다.",
      },
    ],
    sources: [
      {
        title: "후베이성 문화여유청 · 징저우와 강릉의 옛 도성",
        url: "https://wlt.hubei.gov.cn/bmdt/ztzl/zshb/201912/t20191226_1799529.shtml",
      },
      {
        title: "후베이성 지방지판공실 · 장링현지의 범위",
        url: "https://wlt.hubei.gov.cn/bmdt/ztzl/zshb/201911/t20191121_1363624.shtml",
      },
    ],
    evidenceBounds: [112.1, 30.25, 112.3, 30.45],
  },
  {
    place: {
      id: "world-3e0c7bdd2609",
      name: "광저우",
      modernName: "중국 광둥성 광저우",
      aliases: ["광주", "广州", "Guangzhou"],
      kind: "settlement",
      coordinates: [113.25, 23.11667],
      locationNote:
        "현재 광저우 시가지의 대표점이다. 시대별 항만·번방·시박사 시설의 위치와 범위는 서로 다르다.",
    },
    definition:
      "광저우는 중국 남부 주장 삼각주 북쪽의 도시다. 오랜 해상 교역의 거점으로 성장했다.",
    facts: [
      {
        label: "위치",
        value: "광둥성 중남부, 주장 하류의 하구와 가까운 곳에 있다.",
      },
      {
        label: "역사 지리",
        value:
          "시박사는 해외 무역을 관리하던 기관이고 번방은 외국 상인 등의 거주 구역이다. 모두 광저우라는 도시의 옛 이름은 아니다.",
      },
    ],
    sources: [
      {
        title: "광저우시 · 도시 개요",
        url: "https://www.gz.gov.cn/zlgz/gzgk/content/post_2841570.html",
      },
      {
        title: "광저우시 항무국 · 해상 교역과 시박사",
        url: "https://gwj.gz.gov.cn/xwzx/gzgxw/content/post_10901127.html",
      },
      {
        title: "광저우시 항무국 · 광탑 부두와 번방",
        url: "https://gwj.gz.gov.cn/ghzt/gkwh/content/post_10949653.html",
      },
    ],
    evidenceBounds: [113, 22.9, 113.6, 23.4],
  },
];
