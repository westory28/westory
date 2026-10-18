import React from "react";

export const atlasTerrainCreditItems = [
  <span key="terrain-gmba">
    <a
      href="https://doi.org/10.48601/earthenv-t9k2-1407"
      target="_blank"
      rel="noreferrer"
    >
      Snethlage et al. (2022), GMBA Mountain Inventory v2
    </a>
    {" · "}
    <a
      href="https://doi.org/10.1038/s41597-022-01256-y"
      target="_blank"
      rel="noreferrer"
    >
      산지 자료 연구
    </a>
    {" · "}
    <a
      href="https://creativecommons.org/licenses/by/4.0/"
      target="_blank"
      rel="noreferrer"
    >
      CC BY 4.0
    </a>
    {" · 한국 산지 범위 병합·단순화"}
  </span>,
  <span key="terrain-elevation">
    <a
      href="https://registry.opendata.aws/terrain-tiles/"
      target="_blank"
      rel="noreferrer"
    >
      Mapzen Terrain Tiles
    </a>
    {" · USGS GMTED2010/SRTM · NOAA ETOPO1 · "}
    <a
      href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md"
      target="_blank"
      rel="noreferrer"
    >
      고도 자료 출처
    </a>
    {" · 개마고원 일대 해발 1,000m 이상 연속 고지대 추출"}
  </span>,
];

export const ATLAS_TERRAIN_HELP =
  "산맥은 녹색과 능선 무늬, 고원은 회갈색, 사막은 황토색과 점무늬로 구분합니다. 무늬는 지형 종류를 나타내며 실제 능선이나 등고선이 아닙니다. 세계 지형은 Natural Earth의 개략 분포, 한국 산지는 GMBA의 산지 범위를 사용합니다. 개마고원은 공개 고도 자료에서 추출한 주변 고지대로, 고원 전체의 확정 경계를 뜻하지 않습니다.";
