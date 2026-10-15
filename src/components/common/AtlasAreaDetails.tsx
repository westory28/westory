import React from "react";
import type { AtlasAreaFeature } from "../../lib/historyAtlasAreas";
import "./atlasPlaceDetails.css";

export default function AtlasAreaDetails({ area }: { area: AtlasAreaFeature }) {
  return (
    <article className="atlas-place-details" aria-label="지역 설명">
      <div className="atlas-place-details__header">
        <h2>{area.properties.name}</h2>
      </div>
      <p className="atlas-place-details__definition">
        {area.properties.locationNote}
      </p>
      <section>
        <h3>범위 출처</h3>
        <a href={area.properties.sourceUrl} target="_blank" rel="noreferrer">
          {area.properties.source}
        </a>
      </section>
    </article>
  );
}
