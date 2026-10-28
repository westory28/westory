import type { CSSProperties } from "react";
import "./avatarPlaceholder.css";

const placeholderStyle = {
  "--avatar-placeholder-mask": `url("${import.meta.env.BASE_URL}avatar/v1/neutral-silhouette.svg")`,
} as CSSProperties;

export default function AvatarPlaceholder() {
  return (
    <div
      className="avatar-placeholder"
      style={placeholderStyle}
      role="img"
      aria-label="아바타 미선택"
    >
      <span className="avatar-placeholder__silhouette" aria-hidden="true" />
      <span className="avatar-placeholder__question" aria-hidden="true">
        ?
      </span>
    </div>
  );
}
