import { useState } from "react";
import AvatarPlaceholder from "../../features/avatar/AvatarPlaceholder";
import type { WisHallOfFameEntry } from "../../types";
import "./wisHallOfFameAvatar.css";

export default function WisHallOfFameAvatar({
  entry,
  className = "",
}: {
  entry: WisHallOfFameEntry;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | undefined>();
  const url = entry.avatar?.thumbnailUrl;
  return (
    <div
      className={`wis-hall-avatar ${className}`}
      data-hall-avatar={entry.uid}
    >
      {url && failedUrl !== url ? (
        <img
          src={url}
          alt={`${entry.displayName || entry.studentName} 학생의 아바타`}
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <AvatarPlaceholder />
      )}
    </div>
  );
}
