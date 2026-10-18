import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { YutSettings } from "../../../lib/yut";
import useYutPublication from "./useYutPublication";
import WeplayStudioIntro from "./WeplayStudioIntro";
import WeplayMusicButton from "./WeplayMusicButton";
import useYutMusic from "./useYutMusic";
import "./weplay.css";
import "./weplay-catalog.css";

const YutGame = lazy(() => import("./yut/YutGame"));

export default function YutGameEntry({
  portal,
  initialSettings,
}: {
  portal: "student" | "teacher";
  initialSettings?: YutSettings;
}) {
  const access = useYutPublication(portal);
  const [introduced, setIntroduced] = useState(false);
  const [params, setParams] = useSearchParams();
  const [musicActive, setMusicActive] = useState(true);
  const allowed = access.status === "open";
  const music = useYutMusic(musicActive && allowed);
  useEffect(() => {
    setIntroduced(false);
  }, [portal, access.scope]);
  if (!allowed) {
    const status = access.status;
    return (
      <main className="weplay-page" tabIndex={-1}>
        <header className="weplay-heading">
          <h1>마우저구 윷놀이</h1>
        </header>
        <Link className="weplay-catalog-back" to={`/${portal}/weplay`}>
          전체 게임
        </Link>
        <p role={status === "error" ? "alert" : "status"}>
          {status === "checking"
            ? "게임을 확인하고 있습니다."
            : status === "error"
              ? "게임을 확인하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요."
              : "지금은 윷놀이가 열려 있지 않습니다."}
        </p>
        {status !== "checking" && (
          <button className="weplay-primary" onClick={access.retry}>
            다시 확인
          </button>
        )}
      </main>
    );
  }
  return (
    <main
      className={introduced ? "weplay-yut-page" : "weplay-page"}
      tabIndex={-1}
    >
      {!introduced ? (
        <>
          <header className="weplay-heading">
            <h1 tabIndex={-1}>마우저구 윷놀이</h1>
            <div className="weplay-game-navigation">
              <Link
                className="weplay-catalog-back"
                to={
                  portal === "teacher"
                    ? "/teacher/weplay?game=joseon-yut"
                    : "/student/weplay"
                }
              >
                {portal === "teacher" ? "게임 관리" : "전체 게임"}
              </Link>
              <WeplayMusicButton {...music} />
            </div>
          </header>
          <WeplayStudioIntro onComplete={() => setIntroduced(true)} />
        </>
      ) : (
        <Suspense fallback={<p role="status">윷판을 준비하고 있습니다.</p>}>
          <YutGame
            initialSettings={
              portal === "student" ? access.settings : initialSettings
            }
            music={music}
            onMusicActiveChange={setMusicActive}
            portal={portal}
            preview={portal === "teacher" && params.get("view") === "preview"}
            onBack={() =>
              setParams(portal === "teacher" ? { game: "joseon-yut" } : {})
            }
          />
        </Suspense>
      )}
    </main>
  );
}
