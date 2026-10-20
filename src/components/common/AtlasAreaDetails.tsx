import React from "react";
import type { AtlasAreaFeature } from "../../lib/historyAtlasAreas";
import "./atlasPlaceDetails.css";

export default function AtlasAreaDetails({ area }: { area: AtlasAreaFeature }) {
  return (
    <article
      className="atlas-place-details atlas-place-details--scrollable"
      aria-label="지역 설명"
    >
      <header className="atlas-place-details__header">
        <div className="atlas-place-details__title">
          <h2>{area.properties.name}</h2>
        </div>
      </header>
      <div
        className="atlas-place-details__body"
        key={area.properties.id}
        role="region"
        aria-label={`${area.properties.name} 설명 내용`}
        tabIndex={0}
      >
        <p className="atlas-place-details__definition">
          {area.properties.locationNote}
        </p>
        <details
          className="atlas-place-details__sources"
          key={area.properties.id}
        >
          <summary>범위 출처</summary>
          <ul>
            <li>
              <a
                href={area.properties.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                {area.properties.source} ↗
              </a>
            </li>
          </ul>
        </details>
      </div>
    </article>
  );
}
