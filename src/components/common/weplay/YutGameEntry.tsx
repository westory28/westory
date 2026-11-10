import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { YutSettings } from "../../../lib/yut";
import useYutPublication from "./useYutPublication";
import WeplayStudioIntro from "./WeplayStudioIntro";
import WeplayGameFrame from "./WeplayGameFrame";
import WeplayGameLoading from "./WeplayGameLoading";
import WeplayMusicButton from "./WeplayMusicButton";
import useYutMusic from "./useYutMusic";
import "./weplay.css";
import "./weplay-catalog.css";

const loadYutGame = () => import("./yut/YutGame");
const YutGame = lazy(loadYutGame);

export default function YutGameEntry({
  portal,
  initialSettings,
  groupTitle = "위플레이",
}: {
  portal: "student" | "teacher";
  groupTitle?: string;
  initialSettings?: YutSettings;
}) {
  const access = useYutPublication(portal, true);
  const [introduced, setIntroduced] = useState(false);
  const [params, setParams] = useSearchParams();
  const [musicActive, setMusicActive] = useState(true);
  const allowed = access.status === "open";
  const admittedScope = useRef("");
  if (allowed) admittedScope.current = access.scope;
  // A failed publication refresh must block play without discarding the current
  // board or an uncertain command's receipt. Account/semester changes still reset.
  const retainGame = admittedScope.current === access.scope;
  const music = useYutMusic(musicActive && allowed);
  useEffect(() => {
    setIntroduced(false);
    // Download the game while publication is checked and the opening plays.
    void loadYutGame().catch(() => {});
  }, [portal, access.scope]);
  const accessNotice = !allowed && (
    <>
      <p role={access.status === "error" ? "alert" : "status"}>
        {access.status === "checking"
          ? "게임을 확인하고 있습니다."
          : access.status === "error"
            ? "게임을 확인하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요."
            : "지금은 윷놀이가 열려 있지 않습니다."}
      </p>
      {access.status !== "checking" && (
        <button className="weplay-primary" onClick={access.retry}>
          다시 확인
        </button>
      )}
    </>
  );
  if (!allowed && !retainGame) {
    return (
      <main className="weplay-page" tabIndex={-1}>
        <header className="weplay-heading">
          <h1>마우저구 윷놀이</h1>
          <div className="weplay-game-navigation">
            <Link className="weplay-catalog-back" to={`/${portal}/weplay`}>
              전체 게임
            </Link>
            <WeplayMusicButton {...music} />
          </div>
        </header>
        {accessNotice}
      </main>
    );
  }
  return (
    <main className="weplay-game-page weplay-yut-page" tabIndex={-1}>
      <header className="weplay-heading">
        <h1 tabIndex={-1}>마우저구 윷놀이</h1>
        <nav
          className="weplay-game-navigation"
          aria-label={`${groupTitle} 화면 이동`}
        >
          <Link className="weplay-catalog-back" to={`/${portal}/weplay`}>
            전체 게임
          </Link>
          {portal === "teacher" && (
            <Link
              className="weplay-catalog-back"
              to="/teacher/weplay?game=joseon-yut"
            >
              게임 관리
            </Link>
          )}
          <WeplayMusicButton {...music} />
        </nav>
      </header>
      {accessNotice}
      <div hidden={!allowed}>
        <WeplayGameFrame theme="yut">
          {!introduced ? (
            <WeplayStudioIntro onComplete={() => setIntroduced(true)} />
          ) : (
            <Suspense
              fallback={
                <WeplayGameLoading
                  theme="yut"
                  label="윷판을 준비하고 있습니다"
                />
              }
            >
              <YutGame
                key={access.scope}
                suspended={!allowed}
                initialLobby={portal === "student" ? access.lobby : undefined}
                initialSettings={
                  portal === "student" ? access.settings : initialSettings
                }
                music={music}
                onMusicActiveChange={setMusicActive}
                portal={portal}
                preview={
                  portal === "teacher" && params.get("view") === "preview"
                }
                onBack={() =>
                  setParams(portal === "teacher" ? { game: "joseon-yut" } : {})
                }
              />
            </Suspense>
          )}
        </WeplayGameFrame>
      </div>
    </main>
  );
}
