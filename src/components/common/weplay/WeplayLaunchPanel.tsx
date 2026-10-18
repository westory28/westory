import {
  WEPLAY_DIFFICULTY_LABELS,
  type WeplayDifficulty,
} from "../../../lib/weplay";
import "./weplay-launch.css";

type Mode = "practice" | "challenge";
interface Props {
  mode: Mode;
  difficulty: WeplayDifficulty;
  starting?: boolean;
  disabled?: boolean;
  launchIssue?: string;
  challengeCost: number;
  preview?: boolean;
  onModeChange: (mode: Mode) => void;
  onDifficultyChange: (difficulty: WeplayDifficulty) => void;
  onStart: () => void;
}
export default function WeplayLaunchPanel({
  mode,
  difficulty,
  starting = false,
  disabled = false,
  launchIssue = "",
  challengeCost,
  preview = false,
  onModeChange,
  onDifficultyChange,
  onStart,
}: Props) {
  return (
    <section
      className={`weplay-panel weplay-launch is-${mode}`}
      aria-label={preview ? "게임 대기 화면 미리보기" : "게임 시작"}
    >
      <div className="weplay-launch-art">
        <img
          src={`${import.meta.env.BASE_URL}assets/weplay/naval/lobby-turtle-ship.webp`}
          alt="목재 덮개와 쇠못, 낮은 용머리와 노를 갖춘 거북선 재현 일러스트"
          width={1200}
          height={900}
        />
      </div>
      <div className="weplay-launch-controls">
        <div
          className="weplay-mode weplay-mode-choice"
          role="group"
          aria-label="게임 모드"
        >
          <button
            type="button"
            aria-pressed={mode === "practice"}
            disabled={starting}
            onClick={() => {
              onModeChange("practice");
            }}
          >
            <span className="weplay-choice-top">
              <strong>연습하기</strong>
              <span className="weplay-choice-mark" aria-hidden="true">
                {mode === "practice" ? "✓" : ""}
              </span>
            </span>
            <span className="weplay-choice-note">위스 변동 없음</span>
          </button>
          <button
            type="button"
            aria-pressed={mode === "challenge"}
            className="weplay-challenge-choice"
            disabled={starting}
            onClick={() => {
              onModeChange("challenge");
            }}
          >
            <span className="weplay-choice-top">
              <strong>도전하기</strong>
              <span className="weplay-choice-mark" aria-hidden="true">
                {mode === "challenge" ? "✓" : ""}
              </span>
            </span>
            <span className="weplay-choice-note">
              {preview ? "체험 · 위스 변동 없음" : "위스 획득·차감"}
            </span>
          </button>
        </div>
        <h2 className="weplay-selected-mode">난이도</h2>
        <div
          className="weplay-mode weplay-difficulty"
          role="group"
          aria-label="난이도"
        >
          {(Object.keys(WEPLAY_DIFFICULTY_LABELS) as WeplayDifficulty[]).map(
            (value) => (
              <button
                key={value}
                type="button"
                disabled={starting}
                aria-pressed={difficulty === value}
                onClick={() => {
                  onDifficultyChange(value);
                }}
              >
                {WEPLAY_DIFFICULTY_LABELS[value]}
              </button>
            ),
          )}
        </div>
        <div className="weplay-launch-feedback" aria-live="polite">
          {launchIssue && <p>{launchIssue}</p>}
        </div>
        <button
          type="button"
          className="weplay-primary weplay-start"
          disabled={starting || disabled}
          onClick={onStart}
        >
          <span>
            {starting
              ? "시작 준비 중…"
              : mode === "practice"
                ? preview
                  ? "연습 체험 시작"
                  : "연습 시작"
                : preview
                  ? "도전 체험 시작"
                  : `위스 도전 시작 · ${challengeCost}위스`}
          </span>
        </button>
      </div>
    </section>
  );
}
