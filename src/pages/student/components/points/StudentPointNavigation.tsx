import { Link } from "react-router-dom";
import { useAuth } from "../../../../contexts/AuthContext";
import { getStudentMenuLabel } from "../../../../constants/menus";
import { STUDENT_POINT_TAB_LABELS } from "../../../../constants/pointLabels";
import PortalSubNavigation from "../../../../components/common/PortalSubNavigation";

export default function StudentPointNavigation({
  activeTab,
  pageTitle,
}: {
  activeTab: "shop" | "orders";
  pageTitle: string;
}) {
  const { menuConfig } = useAuth();
  return (
    <PortalSubNavigation
      title={pageTitle}
      activeLabel={STUDENT_POINT_TAB_LABELS[activeTab]}
      variant="tabs"
    >
      {(["shop", "orders"] as const).map((tab) => (
        <Link
          key={tab}
          to={`/student/points?tab=${tab}`}
          className={`teacher-settings-menu-item ${activeTab === tab ? "is-active" : ""}`}
          aria-current={activeTab === tab ? "page" : undefined}
        >
          {getStudentMenuLabel(
            menuConfig,
            `/student/points?tab=${tab}`,
            STUDENT_POINT_TAB_LABELS[tab],
          )}
        </Link>
      ))}
    </PortalSubNavigation>
  );
}
