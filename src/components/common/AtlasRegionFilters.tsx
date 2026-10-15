import React, { useId } from "react";
import type { AtlasSubject } from "../../lib/historyAtlas";
import {
  ATLAS_KOREA_PROVINCES,
  ATLAS_WORLD_REGION_GROUPS,
} from "../../lib/historyAtlasRegions";
import InfoHelp from "./InfoHelp";
import "./atlasRegionFilters.css";

interface AtlasRegionFiltersProps {
  subject: AtlasSubject;
  groupId: string;
  subregionId: string;
  onChange: (groupId: string, subregionId: string) => void;
}

export default function AtlasRegionFilters({
  subject,
  groupId,
  subregionId,
  onChange,
}: AtlasRegionFiltersProps) {
  const id = useId();
  const korean = subject === "korea";
  const options = korean ? ATLAS_KOREA_PROVINCES : ATLAS_WORLD_REGION_GROUPS;
  const group = korean
    ? undefined
    : ATLAS_WORLD_REGION_GROUPS.find((item) => item.id === groupId);
  return (
    <>
      <div className="atlas-region-filter">
        <div className="atlas-region-filter__heading">
          <label className="atlas-region-filter__label" htmlFor={id + "-group"}>
            {korean ? "지역 · 8도" : "지역"}
          </label>
          <InfoHelp
            label="지역 분류 기준"
            sections={[
              {
                items: korean
                  ? [
                      "조선 후기 8도 기준으로 장소를 묶은 분류이다. 선택하면 해당 지역의 장소를 지도에서 보여 준다.",
                      "시대별 도 경계를 재현한 영역 지도는 아니다.",
                      "한반도 밖의 장소는 ‘8도 밖’, 지역 분류 근거가 없는 장소는 ‘지역 미분류’에 포함된다.",
                    ]
                  : [
                      "UN 통계 분류(M49)와 교과서의 지리 맥락을 기준으로 장소를 묶은 분류이다. 역사적 국경을 뜻하지는 않는다.",
                      "중동은 서아시아 등 다른 지역과 중복될 수 있다.",
                      "여러 지역에 걸친 장소는 해당 지역에서 함께 찾을 수 있다.",
                      "지역 분류 근거가 없는 장소는 ‘지역 미분류’에 포함된다.",
                    ],
              },
            ]}
          />
        </div>
        <select
          id={id + "-group"}
          value={groupId}
          onChange={(event) => onChange(event.target.value, "")}
        >
          <option value="">전체 지역</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
        </select>
      </div>
      {!!group?.children.length && (
        <div className="atlas-region-filter atlas-region-filter--subregion">
          <label
            className="atlas-region-filter__label"
            htmlFor={id + "-subregion"}
          >
            세부 지역
          </label>
          <select
            id={id + "-subregion"}
            value={subregionId}
            onChange={(event) => onChange(groupId, event.target.value)}
          >
            <option value="">{group.title} 전체</option>
            {group.children.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
