import { useState } from "react";
import type { AvatarCharacter, AvatarItem } from "./catalog";
import { avatarItemPreviewPath } from "./itemPresentation";
import "./avatarItemPreview.css";

/** Offline captures of the actual renderer; a catalog never creates WebGL contexts. */
export default function AvatarItemPreview({
  item,
  character,
  className = "",
}: {
  item: AvatarItem;
  character?: AvatarCharacter;
  className?: string;
}) {
  const src = `${import.meta.env.BASE_URL}${avatarItemPreviewPath(item, character)}`;
  const [failedSource, setFailedSource] = useState("");
  return (
    <span className={`avatar-item-preview ${className}`} aria-hidden="true">
      {failedSource === src ? (
        <span className="avatar-item-preview-unavailable">미리보기 없음</span>
      ) : (
        <img
          src={src}
          alt=""
          width={256}
          height={256}
          loading="lazy"
          decoding="async"
          onError={() => setFailedSource(src)}
        />
      )}
    </span>
  );
}
