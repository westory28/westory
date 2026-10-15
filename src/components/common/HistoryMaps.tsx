import React, { Suspense } from "react";
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

export default function HistoryMaps({
  dataset,
  onOpenOriginals,
}: {
  dataset: AtlasDataset;
  onOpenOriginals?: () => void;
}) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
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
    if (nextView === "globe" && view !== "globe") {
      next.set("subject", view);
    } else {
      next.delete("subject");
    }
    setSearchParams(next, { state: null });
  };
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
            <InlineLoading message="지구본을 불러오는 중입니다." />
          </>
        }
      >
        <HistoryGlobe
          dataset={dataset}
          initialSubject={
            searchParams.get("subject") === "korea" ? "korea" : "world"
          }
          navigation={navigation}
          onOpenOriginals={onOpenOriginals}
        />
      </Suspense>
    );
  }

  return (
    <HistoryAtlas
      key={atlasKey}
      dataset={dataset}
      initialSubject={view}
      navigation={navigation}
      onOpenOriginals={onOpenOriginals}
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
