import type { AvatarItem } from "./catalog";
import { avatarGenderLabel } from "./AvatarShopItemCard";
import { avatarItemTypeLabel } from "./itemPresentation";
import WisIcon from "../../components/common/WisIcon";
import "./avatarShopItem.css";

export default function AvatarShopItemDetails({
  item,
  hidePrice = false,
}: {
  item: AvatarItem;
  hidePrice?: boolean;
}) {
  return (
    <div className="avatar-shop-item-details">
      <strong>{item.label}</strong>
      <span className="avatar-shop-item-meta">
        {avatarItemTypeLabel(item)} · {avatarGenderLabel(item)}
      </span>
      {item.description && <p>{item.description}</p>}
      {!hidePrice && (
        <span className="avatar-shop-item-price">
          {item.price === 0 ? (
            "무료"
          ) : (
            <>
              {item.price.toLocaleString("ko-KR")} <WisIcon />
            </>
          )}
        </span>
      )}
    </div>
  );
}
