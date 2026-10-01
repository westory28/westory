import { MotionTitle, StoryLink } from "./EntryVisuals";

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
          aria-label="위플레이 거북선이 멀리서 가까이 다가와 포탄을 발사하고 바다에 물보라가 이는 장면"
        >
          <img
            className="entry-sea"
            src={
              import.meta.env.BASE_URL + "assets/weplay/naval/sea-battle.webp"
            }
            alt=""
            loading="lazy"
          />
          <span className="entry-sea-wash" />
          <div className="entry-ship-rig" aria-hidden="true">
            <span className="entry-ship-wake" />
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
            />
            <span className="entry-muzzle">
              <span className="entry-muzzle-flash" />
              <span className="entry-muzzle-smoke" />
              <span className="entry-cannon-trail" />
              <span className="entry-cannonball" />
            </span>
            <svg className="entry-impact" viewBox="0 0 160 130">
              <ellipse
                className="entry-impact-ring"
                cx="80"
                cy="106"
                rx="64"
                ry="12"
              />
              <g className="entry-impact-water">
                <path d="M22 106 Q48 85 32 46 Q69 69 65 14 Q85 51 86 78 Q105 56 127 35 Q110 86 143 106 Z" />
                <path d="M49 108 Q70 84 67 53 M88 106 Q89 83 108 67" />
                <circle cx="35" cy="26" r="4" />
                <circle cx="96" cy="12" r="5" />
                <circle cx="137" cy="53" r="3" />
              </g>
            </svg>
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
