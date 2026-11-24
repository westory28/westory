import React, { useState } from "react";
import type { WisHallOfFamePodiumProps } from "./WisHallOfFamePodium";
import type { HallOfFamePodiumSlotKey } from "../../types";
import {
  DEFAULT_WIS_HALL_OF_FAME_PODIUM_IMAGE_URL,
  normalizeHallOfFameInterfaceConfig,
} from "../../lib/wisHallOfFame";
import { formatWisAmount } from "../../lib/pointFormatters";
import WisHallOfFameAvatar from "./WisHallOfFameAvatar";
import "./royalHallOfFamePodium.css";

const SLOTS: Array<{ key: HallOfFamePodiumSlotKey; rank: number }> = [
  { key: "second", rank: 2 },
  { key: "first", rank: 1 },
  { key: "third", rank: 3 },
];
const CENTERS = { second: 20, first: 50, third: 80 };
const TOPS = {
  desktop: { second: 39, first: 27, third: 43 },
  mobile: { second: 30, first: 18, third: 34 },
};
// Preserve each saved position's offset while anchoring the avatar's feet to
// the actual platform surface instead of positioning an emoji by its top.
const FEET = { second: 56, first: 50, third: 60 };

const RoyalHallOfFamePodium: React.FC<WisHallOfFamePodiumProps> = ({
  entries = [],
  hallOfFameConfig,
  title = "명예의 전당",
  subtitle,
  action,
  showHeader = true,
  emptyMessage = "아직 명예의 전당이 준비되지 않았어요.",
  deviceMode = "responsive",
  slotControls,
}) => {
  const [selected, setSelected] = useState<
    Partial<Record<HallOfFamePodiumSlotKey, string>>
  >({});
  const config = normalizeHallOfFameInterfaceConfig(hallOfFameConfig);
  const safeEntries = entries || [];
  const slotCenter = (
    key: HallOfFamePodiumSlotKey,
    mode: "desktop" | "mobile",
  ) =>
    Math.min(
      CENTERS[key] + 5,
      Math.max(CENTERS[key] - 5, config.positions[mode][key].leftPercent),
    );
  const groups = SLOTS.map(({ key, rank }) => {
    const members = safeEntries.filter(
      (entry) => (entry.podiumSlot || entry.rank) === rank,
    );
    const active =
      members.find((entry) => entry.uid === selected[key]) || members[0];
    const tied =
      active &&
      safeEntries.filter((entry) => entry.rank === active.rank).length > 1;
    return {
      key,
      rank,
      members,
      active,
      label: `${tied ? "공동 " : ""}${active?.rank || rank}위`,
    };
  });

  return (
    <section
      className="royal-hall-podium"
      data-device-mode={deviceMode}
      aria-label={title}
    >
      {showHeader && (
        <header className="royal-hall-podium__header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="royal-hall-podium__scene">
        <img
          data-hall-podium-stage
          className="royal-hall-podium__art"
          src={DEFAULT_WIS_HALL_OF_FAME_PODIUM_IMAGE_URL}
          width={1586}
          height={992}
          alt="청색 용보와 붉은 어좌가 있는 중앙 금색 1위 시상대, 왼쪽 은색 2위와 오른쪽 동색 3위 시상대"
        />
        {groups.map(({ key, rank, members, active, label }) => {
          const control = slotControls?.[key];
          const style: React.CSSProperties = {};
          for (const mode of ["desktop", "mobile"] as const) {
            const position = config.positions[mode][key];
            const center = slotCenter(key, mode);
            const nearestSlotDistance = Math.min(
              ...SLOTS.filter((slot) => slot.key !== key).map((slot) =>
                Math.abs(slotCenter(slot.key, mode) - center),
              ),
            );
            const feet =
              FEET[key] +
              Math.min(6, Math.max(-6, position.topPercent - TOPS[mode][key]));
            Object.assign(style, {
              [`--royal-${mode}-left`]: `${center}%`,
              [`--royal-${mode}-feet`]: `${(feet * 992) / 1586}cqw`,
              [`--royal-${mode}-width`]: `${position.widthPercent}%`,
              [`--royal-${mode}-scale`]: position.widthPercent / 24,
              [`--royal-${mode}-badge-width`]: `${Math.min(28, nearestSlotDistance - 2)}cqw`,
            });
          }
          return (
            <div
              key={key}
              className={`royal-hall-podium__avatar royal-hall-podium__avatar--${key}`}
              style={style}
            >
              <div className="royal-hall-podium__portrait">
                {control ? (
                  <button
                    type="button"
                    className="royal-hall-podium__place royal-hall-podium__handle"
                    aria-label={
                      control.dragLabel || `${rank}위 아바타 위치 이동`
                    }
                    onPointerDown={control.onPointerDown}
                    onClick={control.onClick}
                    disabled={control.disabled}
                  >
                    {label}
                  </button>
                ) : (
                  <span className="royal-hall-podium__place">{label}</span>
                )}
                {active && (
                  <WisHallOfFameAvatar
                    entry={active}
                    className="royal-hall-podium__figure"
                  />
                )}
                {members.length > 1 && (
                  <span className="royal-hall-podium__tie-count">
                    {members.length}명
                  </span>
                )}
              </div>
              {active && (
                <section
                  className={`royal-hall-podium__identity royal-hall-podium__identity--${key}`}
                  aria-label={`${label} 학생`}
                >
                  <div className="royal-hall-podium__student">
                    <span className="royal-hall-podium__school">
                      <span>{active.grade}학년</span>
                      <span>{active.class}반</span>
                      {active.number && <span>{active.number}번</span>}
                    </span>
                    <strong className="royal-hall-podium__name">
                      {active.displayName || active.studentName}
                    </strong>
                    <span className="royal-hall-podium__score">
                      {formatWisAmount(active.cumulativeEarned)}
                    </span>
                  </div>
                  {members.length > 1 &&
                    members.map((entry) => (
                      <button
                        type="button"
                        key={entry.uid}
                        className="royal-hall-podium__select"
                        aria-pressed={active?.uid === entry.uid}
                        aria-label={`${label} ${entry.grade}학년 ${entry.class}반 ${entry.number ? `${entry.number}번 ` : ""}${entry.displayName || entry.studentName} 정보 강조`}
                        onClick={() =>
                          setSelected((previous) => ({
                            ...previous,
                            [key]: entry.uid,
                          }))
                        }
                        onFocus={() =>
                          setSelected((previous) => ({
                            ...previous,
                            [key]: entry.uid,
                          }))
                        }
                      >
                        <strong className="royal-hall-podium__name">
                          {entry.displayName || entry.studentName}
                        </strong>
                      </button>
                    ))}
                </section>
              )}
            </div>
          );
        })}
      </div>
      {safeEntries.length === 0 && (
        <p className="royal-hall-podium__empty">{emptyMessage}</p>
      )}
    </section>
  );
};

export default RoyalHallOfFamePodium;
