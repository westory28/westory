import React, { Suspense, useState } from "react";
import HistoryAtlas from "../../components/common/HistoryAtlas";
import { InlineLoading } from "../../components/common/LoadingState";
import PortalWorkspace from "../../components/common/PortalWorkspace";
import { historyAtlasDataset } from "../../data/historyAtlasContent";
import { lazyWithRetry } from "../../lib/lazyWithRetry";

const OriginalMapResources = lazyWithRetry(
  () => import("./MapResources"),
  "teacher-original-map-resources",
);

export default function ManageMaps() {
  const [showOriginals, setShowOriginals] = useState(false);
  return (
    <>
      <div hidden={showOriginals}>
        <PortalWorkspace
          as="main"
          className="history-atlas-page"
          footerActive={!showOriginals}
        >
          <HistoryAtlas
            dataset={historyAtlasDataset}
            onOpenOriginals={() => setShowOriginals(true)}
          />
        </PortalWorkspace>
      </div>
      {showOriginals && (
        <>
          <div className="history-atlas-return">
            <button type="button" onClick={() => setShowOriginals(false)}>
              <i className="fas fa-arrow-left" aria-hidden="true" /> 학습지도
            </button>
          </div>
          <Suspense
            fallback={
              <InlineLoading message="원본 지도를 불러오는 중입니다." />
            }
          >
            <OriginalMapResources />
          </Suspense>
        </>
      )}
    </>
  );
}
