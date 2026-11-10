import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { WEPLAY_GAMES, getWeplayLobby } from "../../../lib/weplay";
import { withWeplayRequestTimeout } from "./requestTimeout";
import { useAuth } from "../../../contexts/AuthContext";
import { getStudentRouteAccess } from "../../../lib/studentMenuAccess";
import useYutPublication from "./useYutPublication";
import { prepareWeplayIntroAudio } from "./weplayIntroAudio";
import "./weplay-catalog.css";

export default function WeplayGameCatalog({
  gameTitle,
  portal,
  groupTitle,
}: {
  gameTitle: string;
  groupTitle?: string;
  portal: "student" | "teacher";
}) {
  const publication = useYutPublication(portal);
  const { currentUser, config, menuConfig, configReady, menuConfigReady } =
    useAuth();
  const navalAllowed =
    configReady &&
    menuConfigReady &&
    getStudentRouteAccess(
      { pathname: "/student/weplay", search: "?game=history-rain" },
      config,
      menuConfig,
    ).allowed;
  const scope = `${currentUser?.uid}/${config?.year}/${config?.semester}/${navalAllowed}`;
  const [naval, setNaval] = useState({ scope: "", status: "checking" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (portal === "teacher" || !navalAllowed) return;
    let active = true;
    setNaval({ scope, status: "checking" });
    void withWeplayRequestTimeout(getWeplayLobby(config))
      .then((lobby) => {
        if (active)
          setNaval({
            scope,
            status: lobby.gameEnabled === true ? "open" : "closed",
          });
      })
      .catch(() => {
        if (active) setNaval({ scope, status: "error" });
      });
    return () => {
      active = false;
    };
  }, [portal, scope, revision]);
  const navalStatus = naval.scope === scope ? naval.status : "checking";
  const games = WEPLAY_GAMES.filter(
    (game) =>
      portal === "teacher" ||
      (configReady &&
        menuConfigReady &&
        getStudentRouteAccess(
          { pathname: "/student/weplay", search: `?game=${game.id}` },
          config,
          menuConfig,
        ).allowed &&
        (game.id === "joseon-yut"
          ? publication.status === "open"
          : navalStatus === "open")),
  );
  return (
    <section
      className="weplay-catalog"
      data-portal={portal}
      aria-labelledby="weplay-catalog-title"
    >
      <div className="weplay-catalog-heading">
        <h1 id="weplay-catalog-title" tabIndex={-1}>
          {groupTitle ?? (portal === "teacher" ? "위플레이 관리" : "위플레이")}
        </h1>
        <span>전체 게임 {games.length}</span>
      </div>
      {portal === "student" &&
        ((navalAllowed && navalStatus === "checking") ||
          publication.status === "checking") && (
          <p role="status">게임을 확인하는 중입니다.</p>
        )}
      {portal === "student" &&
        ((navalAllowed && navalStatus === "error") ||
          publication.status === "error") && (
          <div role="alert">
            게임을 확인하지 못했습니다.{" "}
            <button
              type="button"
              className="weplay-catalog-retry"
              onClick={() => {
                setRevision((value) => value + 1);
                publication.retry();
              }}
            >
              다시 확인
            </button>
          </div>
        )}
      <ul className="weplay-catalog-grid">
        {games.map((game) => {
          const available =
            game.id !== "joseon-yut" || publication.status === "open";
          const content = (
            <>
              {game.id === "joseon-yut" ? (
                <div className="weplay-yut-cover" aria-hidden="true">
                  <img
                    src={`${import.meta.env.BASE_URL}assets/weplay/yut/catalog-toss.webp`}
                    alt=""
                    width={1448}
                    height={1086}
                  />
                </div>
              ) : (
                <img
                  src={`${import.meta.env.BASE_URL}assets/weplay/naval/catalog-yi-sunsin.webp?v=sujagi-2`}
                  alt=""
                  width={960}
                  height={720}
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
                  {available
                    ? portal === "teacher"
                      ? "게임 관리"
                      : "게임 선택"
                    : publication.status === "checking"
                      ? "확인 중…"
                      : publication.status === "error"
                        ? "연결 확인 필요"
                        : "지금은 이용할 수 없음"}
                  {available && <span aria-hidden="true">→</span>}
                </span>
              </div>
            </>
          );
          return (
            <li key={game.id}>
              {available ? (
                <Link
                  className="weplay-game-card"
                  to={`/${portal}/weplay?game=${game.id}`}
                  onClick={(event) => {
                    if (
                      portal === "student" &&
                      !event.ctrlKey &&
                      !event.metaKey &&
                      !event.shiftKey &&
                      !event.altKey
                    )
                      prepareWeplayIntroAudio();
                  }}
                >
                  {content}
                </Link>
              ) : (
                <div
                  className="weplay-game-card is-unavailable"
                  aria-disabled="true"
                >
                  {content}
                </div>
              )}
              {game.id === "joseon-yut" && publication.status === "error" && (
                <button
                  className="weplay-catalog-retry"
                  onClick={publication.retry}
                >
                  다시 확인
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
