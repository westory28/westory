import React, { Suspense, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import type { AtlasDataset, AtlasSubject } from "../../lib/historyAtlas";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import HistoryAtlas from "./HistoryAtlas";
import { InlineLoading } from "./LoadingState";

const HistoryGlobe = lazyWithRetry(
  () => import("./HistoryGlobe"),
  "history-maps-globe",
);

type MapView = AtlasSubject | "globe";
const VIEWS: { id: MapView; label: string }[] = [
  { id: "korea", label: "한국사" },
  { id: "world", label: "세계사" },
  { id: "globe", label: "지구본" },
];

export default function HistoryMaps({ dataset }: { dataset: AtlasDataset }) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showTerrain, setShowTerrain] = useState(false);
  const requestedView = searchParams.get("view");
  const view: MapView =
    requestedView === "world" || requestedView === "globe"
      ? requestedView
      : "korea";
  const routeState = location.state as {
    historyAtlasInstanceKey?: unknown;
  } | null;
  // Related stories can switch subjects inside the atlas. Preserve that mounted
  // selection for a replace navigation; explicit tabs/history get a new key.
  const atlasKey =
    typeof routeState?.historyAtlasInstanceKey === "string"
      ? routeState.historyAtlasInstanceKey
      : `${view}:${location.key}`;
  const chooseView = (nextView: MapView) => {
    if (view === nextView) return;
    const next = new URLSearchParams(searchParams);
    next.set("view", nextView);
    next.delete("subject");
    setSearchParams(next, { state: null });
  };
  const terrainControl = (
    <button
      type="button"
      className="atlas-terrain-toggle"
      aria-pressed={showTerrain}
      title={showTerrain ? "지형 숨기기" : "지형 표시"}
      onClick={() => setShowTerrain((visible) => !visible)}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
        {!showTerrain && <path d="M3 3 21 21" data-terrain-eye-slash="" />}
      </svg>
      <span>지형</span>
    </button>
  );
  const navigation = (
    <div
      className="history-atlas__subjects"
      role="group"
      aria-label="지도 보기"
    >
      {VIEWS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          onClick={() => chooseView(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (view === "globe") {
    return (
      <Suspense
        fallback={
          <>
            {navigation}
            <InlineLoading message="지구본 불러오는 중" />
          </>
        }
      >
        <HistoryGlobe
          dataset={dataset}
          showTerrain={showTerrain}
          toolbar={terrainControl}
          initialSubject={
            searchParams.get("subject") === "korea"
              ? "korea"
              : searchParams.get("subject") === "world"
                ? "world"
                : "all"
          }
          navigation={navigation}
        />
      </Suspense>
    );
  }

  return (
    <HistoryAtlas
      key={atlasKey}
      dataset={dataset}
      showTerrain={showTerrain}
      toolbar={terrainControl}
      initialSubject={view}
      navigation={navigation}
      onSubjectChange={(subject) => {
        if (subject === view) return;
        const next = new URLSearchParams(searchParams);
        next.set("view", subject);
        next.delete("subject");
        setSearchParams(next, {
          replace: true,
          state: { historyAtlasInstanceKey: atlasKey },
        });
      }}
    />
  );
}
