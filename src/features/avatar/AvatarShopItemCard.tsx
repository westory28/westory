import type { AvatarCharacter, AvatarItem } from "./catalog";
import {
  avatarItemGender,
  avatarItemPurchaseTier,
  avatarPurchaseTierLabel,
} from "./catalog";
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
  purchaseLocked = false,
  onSelect,
}: {
  item: AvatarItem;
  character?: AvatarCharacter;
  selected?: boolean;
  owned?: boolean;
  disabled?: boolean;
  hidePrice?: boolean;
  purchaseLocked?: boolean;
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
        <span
          className={`avatar-shop-item-tier${purchaseLocked ? " is-locked" : ""}`}
          aria-label={
            purchaseLocked
              ? `${avatarPurchaseTierLabel(avatarItemPurchaseTier(item))} · 잠김`
              : undefined
          }
        >
          {purchaseLocked && (
            <svg
              width="12"
              height="12"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M6 8V5a4 4 0 0 1 8 0v3M4 8h12v10H4zM10 12v2" />
            </svg>
          )}
          {item.price === 0
            ? "전 등급"
            : avatarPurchaseTierLabel(avatarItemPurchaseTier(item))}
        </span>
      )}
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
