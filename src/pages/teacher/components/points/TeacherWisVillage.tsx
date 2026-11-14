import { useId, useState, type ReactNode } from "react";
import WisShopNavigation from "../../../../components/common/WisShopNavigation";
import PortalWorkspace from "../../../../components/common/PortalWorkspace";
import PortalSubNavigation from "../../../../components/common/PortalSubNavigation";
import TeacherNavigationIcon from "../../../../components/layout/TeacherNavigationIcon";
import "./TeacherWisVillage.css";

/** Same full-height workspace as assessment management, with a narrower menu. */
export default function TeacherWisVillage({
  active,
  children,
}: {
  active?: "products" | "avatar" | "stocks";
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuId = useId();
  if (!active) return <div className="min-w-0">{children}</div>;
  return (
    <PortalWorkspace
      className={`teacher-sub-workspace teacher-sub-workspace--page wis-village-workspace${collapsed ? " is-village-collapsed" : ""}`}
    >
      <PortalSubNavigation
        className="wis-village-navigation"
        title="위스 마을"
        activeLabel={
          {
            products: "위스 상점",
            avatar: "아바타 상점",
            stocks: "위스피(WsPI)",
          }[active]
        }
        open={mobileOpen}
        onOpenChange={setMobileOpen}
      >
        <div id={menuId} className="wis-village-menu">
          <WisShopNavigation
            portal="teacher"
            active={active}
            variant="items"
            onNavigate={() => setMobileOpen(false)}
          />
        </div>
        <button
          type="button"
          className="wis-village-collapse"
          aria-label={`위스 마을 목차 ${collapsed ? "펼치기" : "접기"}`}
          title={`위스 마을 목차 ${collapsed ? "펼치기" : "접기"}`}
          aria-expanded={!collapsed}
          aria-controls={menuId}
          onClick={() => setCollapsed((value) => !value)}
        >
          <TeacherNavigationIcon name="chevron" />
        </button>
      </PortalSubNavigation>
      <div className="teacher-sub-content wis-village-content">{children}</div>
    </PortalWorkspace>
  );
}
