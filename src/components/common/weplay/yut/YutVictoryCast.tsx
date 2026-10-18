import type { YutRoom } from "../../../../../functions/yutCore.mjs";
import { PROFESSIONS, YutSprite } from "./YutArt";
import "./yut-victory-cast.css";

/** A single finish tableau: four finite winner hops and still, prone opponents. */
export default function YutVictoryCast({ room }: { room: YutRoom }) {
  const winner = room.players.find((player) => player.uid === room.winnerUid);
  const others = room.players.filter((player) => player.uid !== room.winnerUid);
  if (!winner) return null;
  return (
    <div
      className="yut-victory-cast"
      role="group"
      aria-label="경기 결과 캐릭터"
    >
      <div
        className="yut-victory-cast-winner"
        aria-label={`${winner.name} 우승`}
      >
        <span className="yut-victory-cast-winner-shadow" aria-hidden="true" />
        <div className="yut-victory-cast-winner-figure">
          <YutSprite role={winner.role} pose="win" />
        </div>
      </div>
      <div className="yut-victory-cast-others">
        {others.map((player) => (
          <div className="yut-victory-cast-other" key={player.uid}>
            <span
              className={`yut-defeated-sprite yut-defeated-sprite--${player.role}`}
              aria-hidden="true"
              style={{
                backgroundImage: `url(${import.meta.env.BASE_URL}assets/weplay/yut/characters-defeated.webp)`,
              }}
            />
            <span
              className="yut-victory-cast-name"
              title={`${player.name} · ${PROFESSIONS[player.role].clan}`}
            >
              {player.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
