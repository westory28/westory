import "./avatarPlaceholder.css";

export default function AvatarPlaceholder() {
  return (
    <div className="avatar-placeholder" role="img" aria-label="아바타 미선택">
      <img
        className="avatar-placeholder__silhouette"
        src={`${import.meta.env.BASE_URL}avatar/v1/neutral-base-v1.webp`}
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
