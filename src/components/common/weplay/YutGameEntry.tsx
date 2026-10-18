import { lazy, Suspense, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import WeplayStudioIntro from "./WeplayStudioIntro";
import WeplayMusicButton from "./WeplayMusicButton";
import useYutMusic from "./useYutMusic";
import "./weplay.css";
import "./weplay-catalog.css";

const YutGame = lazy(() => import("./yut/YutGame"));

export default function YutGameEntry({
  portal,
}: {
  portal: "student" | "teacher";
}) {
  const [introduced, setIntroduced] = useState(false);
  const [params, setParams] = useSearchParams();
  const [musicActive, setMusicActive] = useState(true);
  const music = useYutMusic(musicActive);
  return (
    <main
      className={introduced ? "weplay-yut-page" : "weplay-page"}
      tabIndex={-1}
    >
      {!introduced ? (
        <>
          <header className="weplay-heading">
            <h1 tabIndex={-1}>사농공상 윷놀이</h1>
            <div className="weplay-game-navigation">
              <Link className="weplay-catalog-back" to={`/${portal}/weplay`}>
                전체 게임
              </Link>
              <WeplayMusicButton {...music} />
            </div>
          </header>
          <WeplayStudioIntro onComplete={() => setIntroduced(true)} />
        </>
      ) : (
        <Suspense fallback={<p role="status">윷판을 준비하고 있습니다.</p>}>
          <YutGame
            music={music}
            onMusicActiveChange={setMusicActive}
            portal={portal}
            preview={portal === "teacher" && params.get("view") === "preview"}
            onBack={() => setParams({})}
          />
        </Suspense>
      )}
    </main>
  );
}
