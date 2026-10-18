import type { YutRoom } from "../../../../../functions/yutCore.mjs";
import { YutSprite } from "./YutArt";
import "./yut-victory-cast.css";

/** Only the winner enters the celebration; opponents remain on their board tiles. */
export default function YutVictoryCast({ room }: { room: YutRoom }) {
  const winner = room.players.find((player) => player.uid === room.winnerUid);
  if (!winner) return null;
  return (
    <div className="yut-victory-cast" role="group" aria-label="우승 캐릭터">
      <div
        className="yut-victory-cast-winner"
        aria-label={`${winner.name} 우승`}
      >
        <div className="yut-victory-cast-winner-figure">
          <YutSprite role={winner.role} pose="win" />
        </div>
      </div>
    </div>
  );
}
