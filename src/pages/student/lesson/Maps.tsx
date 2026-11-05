import { getStudentMenuLabel } from "../../../constants/menus";
import React from "react";
import HistoryMaps from "../../../components/common/HistoryMaps";
import PortalWorkspace from "../../../components/common/PortalWorkspace";
import { historyAtlasDataset } from "../../../data/historyAtlasContent";
import { useAuth } from "../../../contexts/AuthContext";

export default function StudentMaps() {
  const { menuConfig } = useAuth();
  return (
    <PortalWorkspace as="main" className="history-atlas-page">
      <HistoryMaps
        dataset={historyAtlasDataset}
        title={getStudentMenuLabel(
          menuConfig,
          "/student/lesson/maps",
          "역사 지도",
        )}
      />
    </PortalWorkspace>
  );
}
