import React from "react";
import HistoryMaps from "../../../components/common/HistoryMaps";
import PortalWorkspace from "../../../components/common/PortalWorkspace";
import { historyAtlasDataset } from "../../../data/historyAtlasContent";

export default function StudentMaps() {
  return (
    <PortalWorkspace as="main" className="history-atlas-page">
      <HistoryMaps dataset={historyAtlasDataset} />
    </PortalWorkspace>
  );
}
