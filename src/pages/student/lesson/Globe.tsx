import React from "react";
import HistoryGlobe from "../../../components/common/HistoryGlobe";
import PortalWorkspace from "../../../components/common/PortalWorkspace";
import { historyAtlasDataset } from "../../../data/historyAtlasContent";

export default function StudentGlobe() {
  return (
    <PortalWorkspace as="main" className="history-globe-page">
      <HistoryGlobe dataset={historyAtlasDataset} />
    </PortalWorkspace>
  );
}
