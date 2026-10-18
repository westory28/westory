import { Link } from "react-router-dom";
import { WEPLAY_GAMES } from "../../../lib/weplay";
import "./weplay-catalog.css";

export default function WeplayGameCatalog({
  gameTitle,
  portal,
}: {
  gameTitle: string;
  portal: "student" | "teacher";
}) {
  return (
    <section className="weplay-catalog" aria-labelledby="weplay-catalog-title">
      <div className="weplay-catalog-heading">
        <h1 id="weplay-catalog-title" tabIndex={-1}>
          {portal === "teacher" ? "위플레이 관리" : "위플레이"}
        </h1>
        <span>전체 게임 {WEPLAY_GAMES.length}</span>
      </div>
      <ul className="weplay-catalog-grid">
        {WEPLAY_GAMES.map((game) => (
          <li key={game.id}>
            <Link
              className="weplay-game-card"
              to={`/${portal}/weplay?game=${game.id}`}
            >
              {game.id === "joseon-yut" ? (
                <div className="weplay-yut-cover" aria-hidden="true">
                  <img
                    src={`${import.meta.env.BASE_URL}assets/weplay/yut/courtyard.webp`}
                    alt=""
                    width={1672}
                    height={941}
                  />
                  <span className="weplay-yut-cover-title">사농공상</span>
                  <div className="weplay-yut-cover-cast">
                    {["0% 0%", "100% 0%", "0% 100%", "100% 100%"].map(
                      (position) => (
                        <span
                          key={position}
                          style={{ backgroundPosition: position }}
                        />
                      ),
                    )}
                  </div>
                </div>
              ) : (
                <img
                  src={`${import.meta.env.BASE_URL}assets/weplay/naval/lobby-turtle-ship.webp`}
                  alt=""
                  width={1200}
                  height={900}
                />
              )}
              <div className="weplay-game-card-body">
                <h2>{game.id === "history-rain" ? gameTitle : game.name}</h2>
                <span className="weplay-game-card-kind">
                  {game.id === "joseon-yut"
                    ? "전통 · 전략 · 1~4인"
                    : "역사 · 타자 · 1인"}
                </span>
                <span className="weplay-game-card-action">
                  {portal === "teacher" ? "게임 관리" : "게임 선택"}
                  <span aria-hidden="true">→</span>
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
