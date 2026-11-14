import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../../../contexts/AuthContext";
import { getStudentMenuLabel } from "../../../../constants/menus";
import { STUDENT_POINT_TAB_LABELS } from "../../../../constants/pointLabels";

export default function StudentPointNavigation({
  activeTab,
  pageTitle,
}: {
  activeTab: keyof typeof STUDENT_POINT_TAB_LABELS;
  pageTitle: string;
}) {
  const { menuConfig } = useAuth();
  const [, setSearchParams] = useSearchParams();
  return (
    <div className="mb-6 overflow-x-auto">
      <nav className="ws-page-tabs" aria-label={`${pageTitle} 메뉴`}>
        {(
          Object.keys(STUDENT_POINT_TAB_LABELS) as Array<
            keyof typeof STUDENT_POINT_TAB_LABELS
          >
        ).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSearchParams(tab === "overview" ? {} : { tab })}
            aria-current={activeTab === tab ? "page" : undefined}
          >
            {getStudentMenuLabel(
              menuConfig,
              tab === "overview"
                ? "/student/points"
                : `/student/points?tab=${tab}`,
              STUDENT_POINT_TAB_LABELS[tab],
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
