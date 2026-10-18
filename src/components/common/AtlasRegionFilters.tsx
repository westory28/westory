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
  areaOptions?: { id: string; title: string }[];
  selectedAreaId?: string;
  onAreaChange?: (id: string) => void;
}

export default function AtlasRegionFilters({
  subject,
  groupId,
  subregionId,
  onChange,
  areaOptions,
  selectedAreaId,
  onAreaChange,
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
                      "8도 이름은 유지하고 현재 도·광역시 경계를 묶어 표시한다. 위치가 확인된 장소는 현재 범위로 분류한다.",
                      "시대별 영토나 과거 도 경계를 재현한 지도는 아니다.",
                      ...(areaOptions
                        ? [
                            "관서·관동·호남·영남 등은 전통 지역명이다. 전통 지역 범위는 현대 행정 경계를 참고해 표시하며, 기호는 경기와 호서를 함께 가리킨다.",
                          ]
                        : []),
                      "한반도 밖의 장소는 ‘8도 밖’, 지역 분류 근거가 없는 장소는 ‘지역 미분류’에 포함된다.",
                    ]
                  : [
                      "현재 국가·대륙·해역 자료와 UN 통계 분류(M49)를 바탕으로 범위를 표시한다. 역사적 국경을 뜻하지는 않는다.",
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
          value={selectedAreaId ? `area:${selectedAreaId}` : groupId}
          onChange={(event) =>
            event.target.value.startsWith("area:")
              ? onAreaChange?.(event.target.value.slice(5))
              : onChange(event.target.value, "")
          }
        >
          <option value="">전체 지역</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
          {korean && areaOptions && (
            <optgroup label="전통 지역 범위">
              {areaOptions.map((option) => (
                <option key={option.id} value={`area:${option.id}`}>
                  {option.title}
                </option>
              ))}
            </optgroup>
          )}
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
