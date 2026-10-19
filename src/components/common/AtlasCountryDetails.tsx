import type { AtlasCountryFeature } from "../../lib/historyAtlasCountries";
import { getAtlasCountryProfile } from "../../lib/historyAtlasCountryProfiles";
import InfoHelp from "./InfoHelp";
import "./atlasPlaceDetails.css";

/** Shared by the flat world map and globe, including non-sovereign territories. */
export default function AtlasCountryDetails({
  country,
}: {
  country: AtlasCountryFeature;
}) {
  const { id, name } = country.properties;
  const profile = getAtlasCountryProfile(id);
  return (
    <article className="atlas-place-details" aria-label={`${name} 설명`}>
      <header className="atlas-place-details__header">
        <div className="atlas-place-details__title">
          <h2>{name}</h2>
          {id === "KOR" && (
            <InfoHelp
              label="대한민국 설명과 지도 범위"
              sections={[
                {
                  title: "설명과 지도 범위",
                  rows: [
                    {
                      label: "설명",
                      content:
                        "아래 글은 출처 문서의 대한민국에 관한 설명입니다.",
                    },
                    {
                      label: "범위",
                      content:
                        "지도는 한반도를 하나의 영역으로 표시합니다. 이 표시가 대한민국의 현재 실효 지배 범위를 뜻하지는 않습니다.",
                    },
                  ],
                },
              ]}
            />
          )}
        </div>
      </header>
      {profile ? (
        <>
          <p className="atlas-place-details__definition">{profile.overview}</p>
          {profile.relationshipStatus !== "domestic" && (
            <section
              className="atlas-place-details__context"
              aria-label="대한민국과의 관계"
            >
              <div className="atlas-place-details__section-heading">
                <h3>대한민국과의 관계</h3>
              </div>
              {profile.relations.length ? (
                <div className="atlas-place-details__paragraphs">
                  {profile.relations.map((text) => (
                    <p key={text}>{text}</p>
                  ))}
                </div>
              ) : (
                <p className="atlas-place-details__name-note">
                  확인한 공개 자료에는 대한민국과의 관계를 설명한 내용이
                  없습니다.
                </p>
              )}
            </section>
          )}
          {profile.history.length > 0 && (
            <section className="atlas-place-details__context" aria-label="역사">
              <div className="atlas-place-details__section-heading">
                <h3>역사</h3>
              </div>
              <div className="atlas-place-details__paragraphs">
                {profile.history.map((text) => (
                  <p key={text}>{text}</p>
                ))}
              </div>
            </section>
          )}
          <details className="atlas-place-details__sources" key={id}>
            <summary>설명 출처·이용 조건</summary>
            <ul>
              {profile.sources.map((source) => (
                <li key={source.url}>
                  <strong>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.title} ↗
                    </a>
                  </strong>
                  <span>
                    <a
                      href={source.historyUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.author}
                    </a>
                    {" · "}
                    <a
                      href={source.licenseUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.license}
                    </a>
                  </span>
                  <span>{source.changes}</span>
                  <span>
                    원문 판 {source.revisionId} · 수집{" "}
                    {source.retrievedAt.slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <p className="atlas-place-details__name-note">
          이 국가·지역의 설명 자료를 찾지 못했습니다.
        </p>
      )}
    </article>
  );
}
