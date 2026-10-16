import { useEffect, useId, useRef, useState } from "react";
import { useEntryMotionEnabled } from "./EntryMotionContext";
import type { EntryMapMotionController } from "./entryMapMotionRenderer";
import "../common/atlasPlaceDetails.css";
import "./entry-map-motion.css";

export default function EntryMapMotion() {
  const root = useRef<HTMLDivElement>(null);
  const controller = useRef<EntryMapMotionController | null>(null);
  const enabled = useEntryMotionEnabled();
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const id = useId().replace(/:/g, "");

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let cancelled = false;
    let started = false;
    setError(false);
    setReady(false);
    const load = async () => {
      if (started) return;
      started = true;
      try {
        const { loadEntryMapMotion, mountEntryMapMotion } =
          await import("./entryMapMotionRenderer");
        const data = await loadEntryMapMotion();
        if (cancelled) return;
        controller.current = mountEntryMapMotion(
          element,
          data,
          enabledRef.current,
        );
        setReady(true);
      } catch {
        if (!cancelled) setError(true);
      }
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
      controller.current?.dispose();
      controller.current = null;
    };
  }, [attempt]);

  useEffect(() => controller.current?.setEnabled(enabled), [enabled, ready]);

  return (
    <div ref={root} className="entry-map-motion" aria-label="역사 지도 체험">
      <div className="entry-map-motion__stage" aria-busy={!ready && !error}>
        <svg
          className="entry-map-motion__map"
          role="img"
          aria-labelledby={`${id}-title ${id}-desc`}
        >
          <title id={`${id}-title`}>움직이는 역사 지구본</title>
          <desc id={`${id}-desc`}>
            지구본을 회전하고 한양과 나일강을 확대하여 역사 이야기를 살펴본다.
          </desc>
          <defs>
            <clipPath id={`${id}-viewport`}>
              <circle data-map-layer="viewport" />
            </clipPath>
            <radialGradient id={`${id}-shade`} cx=".35" cy=".28" r=".75">
              <stop offset=".6" stopColor="var(--entry-blue)" stopOpacity="0" />
              <stop offset="1" stopColor="var(--entry-blue)" stopOpacity=".1" />
            </radialGradient>
          </defs>
          <g clipPath={`url(#${id}-viewport)`}>
            <path data-map-layer="ocean" />
            <path data-map-layer="grid" />
            <path data-map-layer="land" />
            <path data-map-layer="desert" />
            <path data-map-layer="borders" />
            <path data-map-layer="disputed" />
            <path data-map-layer="rivers" />
            <path data-map-layer="river-halo" />
            <path data-map-layer="river-selected" />
            <circle data-map-layer="shade" fill={`url(#${id}-shade)`} />
            <g data-map-layer="labels" />
          </g>
          <g data-map-layer="selection" opacity="0">
            <circle className="entry-map-motion__ripple" />
            <circle className="entry-map-motion__ripple" />
            <circle className="entry-map-motion__dot" r="5" />
          </g>
          <g data-map-layer="badge" opacity="0">
            <rect height="30" rx="8" />
            <text x="12" y="20" />
          </g>
        </svg>
        <article
          className="entry-map-motion__detail atlas-place-details"
          aria-hidden="true"
        >
          <header className="atlas-place-details__header">
            <div className="atlas-place-details__title">
              <h3 data-map-name>한양</h3>
            </div>
          </header>
          <section className="atlas-place-details__context">
            <div className="atlas-place-details__section-heading">
              <h4>역사 속 이 장소</h4>
              <span data-map-era />
            </div>
            <p
              className="atlas-place-details__definition"
              data-map-definition
            />
            <ul>
              <li data-map-story />
            </ul>
          </section>
          <dl className="atlas-place-details__facts">
            <div>
              <dt>현재 위치</dt>
              <dd data-map-location />
            </div>
          </dl>
        </article>
        <span className="entry-map-motion__attribution">
          Natural Earth · 현재 지형·경계
        </span>
        {!ready && (
          <div
            className="entry-map-motion__status"
            role={error ? "alert" : "status"}
          >
            {error ? (
              <>
                <span>지도를 불러오지 못했습니다.</span>
                <button
                  type="button"
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  다시 불러오기
                </button>
              </>
            ) : (
              "지도 불러오는 중"
            )}
          </div>
        )}
      </div>
      <div className="entry-map-motion__controls">
        <div className="entry-map-motion__scenes" aria-label="지도 장면 선택">
          {[
            ["globe", "지구본"],
            ["hanyang", "한양"],
            ["nile", "나일강"],
          ].map(([scene, name]) => (
            <button
              type="button"
              key={scene}
              data-map-scene={scene}
              disabled={!ready}
              aria-pressed="false"
            >
              {name}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-map-toggle
          disabled={!ready}
          aria-label="지도 모션 일시정지"
        >
          일시정지
        </button>
      </div>
      <span className="entry-map-motion__announcement" aria-live="polite" />
    </div>
  );
}
