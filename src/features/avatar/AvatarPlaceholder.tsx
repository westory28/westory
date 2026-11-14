import "./avatarPlaceholder.css";
import silhouette from "./avatarPlaceholderImage";

export default function AvatarPlaceholder() {
  return (
    <div className="avatar-placeholder" role="img" aria-label="아바타 미선택">
      <img
        className="avatar-placeholder__silhouette"
        src={silhouette}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
      <span className="avatar-placeholder__question" aria-hidden="true">
        ?
      </span>
    </div>
  );
}
