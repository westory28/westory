import type { AvatarCharacter, AvatarItem } from "./catalog";
import { avatarItemGender } from "./catalog";
import AvatarItemPreview from "./AvatarItemPreview";
import WisIcon from "../../components/common/WisIcon";
import "./avatarShopItem.css";

export const avatarGenderLabel = (item: AvatarItem) =>
  ({ boy: "남자", girl: "여자", unisex: "공용" })[avatarItemGender(item)];

export default function AvatarShopItemCard({
  item,
  character,
  selected = false,
  owned = false,
  disabled = false,
  hidePrice = false,
  onSelect,
}: {
  item: AvatarItem;
  character?: AvatarCharacter;
  selected?: boolean;
  owned?: boolean;
  disabled?: boolean;
  hidePrice?: boolean;
  onSelect?: () => void;
}) {
  const content = (
    <>
      <span className="avatar-shop-item-image">
        <AvatarItemPreview item={item} character={character} />
        <span className="avatar-shop-item-gender">
          {avatarGenderLabel(item)}
        </span>
        {selected && (
          <span className="avatar-shop-item-check" aria-label="선택됨">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m5 10 3 3 7-7" />
            </svg>
          </span>
        )}
      </span>
      <span className="avatar-studio-item-name avatar-shop-item-name">
        {item.label}
      </span>
      {!hidePrice && (
        <span className="avatar-shop-item-price">
          {item.price === 0 ? (
            "무료"
          ) : owned ? (
            "보유"
          ) : (
            <>
              {item.price.toLocaleString("ko-KR")} <WisIcon />
            </>
          )}
        </span>
      )}
    </>
  );
  return onSelect ? (
    <button
      type="button"
      className="avatar-shop-item avatar-studio-item"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      title={item.label}
    >
      {content}
    </button>
  ) : (
    <div className="avatar-shop-item" title={item.label}>
      {content}
    </div>
  );
}
