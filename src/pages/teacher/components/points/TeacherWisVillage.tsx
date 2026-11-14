import type { ReactNode } from "react";
import WisShopNavigation from "../../../../components/common/WisShopNavigation";
import "./TeacherWisVillage.css";

/** This route-local exception leaves ordinary Wis management and student tabs intact. */
export default function TeacherWisVillage({
  active,
  children,
}: {
  active?: "products" | "avatar" | "stocks";
  children: ReactNode;
}) {
  if (!active) return <div className="min-w-0">{children}</div>;
  return (
    <div className="wis-village-workspace">
      <WisShopNavigation portal="teacher" active={active} variant="rail" />
      <div className="wis-village-content">{children}</div>
    </div>
  );
}
