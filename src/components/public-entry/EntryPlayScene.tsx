import { MotionTitle, StoryLink } from "./EntryVisuals";
import EntryRibbon from "./EntryRibbon";
import "./entry-play-scene.css";

/** Static game art and scroll-scrubbed effects; no game session or network calls. */
export default function EntryPlayScene() {
  return (
    <section
      id="entry-game"
      tabIndex={-1}
      className="entry-play entry-scene"
      data-entry-scene
      data-entry-timeline
      aria-labelledby="entry-play-title"
    >
      <div className="entry-stage entry-play-stage">
        <EntryRibbon variant="wide" />
        <div className="entry-heading">
          <StoryLink number="06" label="위플레이" />
          <MotionTitle
            id="entry-play-title"
            lines={["다시 만난 역사 용어,", "이번에는 플레이로."]}
          />
          <p className="entry-benefit">
            역사 단어를 떠올려 화포를 발사하는
            <br />
            <span className="entry-game-name">‘내가 충무공이라고?!’</span>
          </p>
        </div>
        <div
          className="entry-ocean"
          role="img"
          aria-label="실제 위플레이 게임 아트: 거북선이 다가온 뒤 이순신의 눈빛이 등장하는 장면"
        >
          <img
            className="entry-sea"
            src={
              import.meta.env.BASE_URL + "assets/weplay/naval/sea-battle.webp"
            }
            width="1672"
            height="941"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <span className="entry-sea-wash" />
          <div className="entry-ship-rig" aria-hidden="true">
            <img
              className="entry-ship"
              src={
                import.meta.env.BASE_URL +
                "assets/weplay/naval/allied-ship.webp"
              }
              width="1000"
              height="667"
              alt=""
              loading="lazy"
              decoding="async"
            />
          </div>
          <div className="entry-game-cutin" aria-hidden="true">
            <img
              className="entry-game-cutin-lines"
              src={
                import.meta.env.BASE_URL +
                "assets/weplay/naval/impact-lines.webp"
              }
              width="1200"
              height="800"
              alt=""
              loading="lazy"
              decoding="async"
            />
            <img
              className="entry-game-cutin-eyes"
              src={
                import.meta.env.BASE_URL +
                "assets/weplay/naval/yi-sunsin-cutin.webp"
              }
              width="1440"
              height="480"
              alt=""
              loading="lazy"
              decoding="async"
            />
          </div>
          <div className="entry-play-caption">
            <span>위플레이</span>
            <strong>내가 충무공이라고?!</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
