import { useEffect, useId, useRef, useState } from "react";
import NavalBattleGame from "./NavalBattleGame";
import {
  DEFAULT_WEPLAY_DIFFICULTIES,
  type WeplaySession,
} from "../../../lib/weplay";
import "./weplay-guide.css";
import { DEFAULT_WEPLAY_GAME_TITLE } from "../../../lib/weplayTitle";

const ART = `${import.meta.env?.BASE_URL || "/"}assets/weplay/naval/`;
const STEPS = [
  {
    target: "timeline",
    title: "맛을 고르고, 전투 흐름을 확인하세요",
    text: "착한맛·중간맛·매운맛 중 하나를 고릅니다. 한 판은 초반·중반·후반으로 갈수록 빨라집니다. 연습은 위스 변동이 없고, 도전은 시작 전 참가비와 보상을 확인하세요.",
  },
  {
    target: "words",
    title: "물보라 위로 떠오르는 단어",
    text: "수업 자료에서 가져온 단어입니다. 단어 아래의 시간이 끝나기 전에 화면에 보이는 단어를 입력하세요.",
  },
  {
    target: "input",
    title: "단어를 쓰고 Enter를 누르세요",
    text: "모바일에서는 ‘장전’ 버튼도 사용할 수 있습니다. 화면에 떠 있는 단어라면 어느 것부터 입력해도 됩니다.",
  },
  {
    target: "charge",
    title: "포탄을 모으면 자동으로 발사합니다",
    text: "착한맛은 2개, 중간맛은 3개, 매운맛은 4개 단어마다 함포가 나갑니다. 장전 칸이 얼마나 찼는지 확인하세요.",
  },
  {
    target: "special",
    title: "긴 단어는 5초 안에!",
    text: "필살기 단어를 정확히 입력하면 학익진 또는 생즉사 사즉생이 발동합니다. 눈빛 연출과 함께 적에게 큰 피해를 줍니다.",
  },
  {
    target: "health",
    title: "적은 위, 아군은 아래",
    text: "적 체력을 깎으면 격침할 수 있습니다. 입력이 늦어지면 적도 공격합니다. 나가기에서 현재 기록으로 종료할 수 있고, 도움말에서 이 안내를 다시 볼 수 있습니다.",
  },
];
const DEMO: WeplaySession = {
  id: "weplay-guide-demo",
  difficulty: "mild",
  mode: "practice",
  status: "active",
  startsAtMs: 100000,
  serverNowMs: 102000,
  endsAtMs: 190000,
  battleVersion: 1,
  acceptedWordIds: ["guide-loaded"],
  acceptedEvents: [{ wordId: "guide-loaded", elapsedMs: 1000 }],
  correctCount: 1,
  difficultySettings: DEFAULT_WEPLAY_DIFFICULTIES.mild,
  words: ["훈민정음", "거북선", "한산도", "신기전"].map((text, index) => ({
    id: index === 0 ? "guide-loaded" : `guide-word-${index}`,
    text,
    unitId: "guide",
    lessonTitle: "게임 안내",
    context: "",
    stage: 1,
    spawnAtMs: 0,
    fallDurationMs: 12000,
    kind: "normal",
  })),
  policy: {
    enabled: false,
    challengeCost: 0,
    dailyChallengeLimit: 0,
    resultRewards: [],
    rankingPeriod: "weekly",
    rankingRewards: {
      mild: { first: 0, second: 0, third: 0 },
      medium: { first: 0, second: 0, third: 0 },
      spicy: { first: 0, second: 0, third: 0 },
    },
  },
  result: null,
};

interface Props {
  gameTitle?: string;
  open: boolean;
  saving: boolean;
  error: string;
  gameRunning?: boolean;
  onFinish: () => void;
  onCloseForNow: () => void;
}

export default function WeplayGuide({
  gameTitle = DEFAULT_WEPLAY_GAME_TITLE,
  open,
  saving,
  error,
  gameRunning = false,
  onFinish,
  onCloseForNow,
}: Props) {
  const [step, setStep] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const selected = STEPS[step];
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      returnTo.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setStep(0);
      element.showModal();
      heading.current?.focus({ preventScroll: true });
    } else if (!open && element.open) {
      element.close();
      const previous = returnTo.current;
      const container = element.closest("main");
      const fallback =
        container?.querySelector<HTMLElement>(".naval-result h2[tabindex]") ||
        container?.querySelector<HTMLElement>(".weplay-guide-launch");
      (previous?.isConnected ? previous : fallback)?.focus({
        preventScroll: true,
      });
    }
  }, [open]);
  useEffect(() => {
    if (open) heading.current?.focus({ preventScroll: true });
  }, [step]);
  useEffect(() => {
    if (error) retry.current?.focus({ preventScroll: true });
  }, [error]);
  return (
    <dialog
      ref={dialog}
      className="weplay-guide"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={saving}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) {
          if (error) onCloseForNow();
          else onFinish();
        }
      }}
    >
      {open && (
        <>
          <div className="weplay-guide-header">
            <strong>{gameTitle} · 게임 안내</strong>
            <span>
              {step + 1} / {STEPS.length}
            </span>
          </div>
          {gameRunning && (
            <p className="weplay-guide-live" role="status">
              진행 중인 전투의 시간은 계속 흐릅니다.
            </p>
          )}
          <div
            className="weplay-guide-demo weplay-page"
            data-guide-step={selected.target}
            aria-label="시간이 흐르지 않는 안내 화면"
          >
            <NavalBattleGame
              gameTitle={gameTitle}
              session={DEMO}
              config={null}
              onComplete={() => undefined}
              guideDemo
            />
            {selected.target === "special" && (
              <div className="weplay-guide-special">
                <img
                  src={`${ART}yi-sunsin-cutin.webp`}
                  alt="필살기 발동 시 나타나는 이순신 장군의 눈빛 연출"
                />
                <strong>학익진 발동</strong>
                <span>혼일강리역대국도지도 · 5초</span>
              </div>
            )}
          </div>
          <div className="weplay-guide-card">
            <h2 ref={heading} tabIndex={-1} id={titleId}>
              {selected.title}
            </h2>
            <p id={descriptionId}>{selected.text}</p>
            {error && (
              <p className="weplay-guide-error" role="alert">
                {error}
              </p>
            )}
            <div className="weplay-guide-actions">
              {error ? (
                <>
                  <button
                    type="button"
                    onClick={onCloseForNow}
                    disabled={saving}
                  >
                    이번에는 닫기
                  </button>
                  <button
                    ref={retry}
                    type="button"
                    className="weplay-guide-next"
                    onClick={onFinish}
                    disabled={saving}
                  >
                    {saving ? "저장 중…" : "다시 저장"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="weplay-guide-skip"
                    onClick={onFinish}
                    disabled={saving}
                  >
                    건너뛰기
                  </button>
                  {step > 0 && (
                    <button
                      type="button"
                      onClick={() => setStep(step - 1)}
                      disabled={saving}
                    >
                      이전
                    </button>
                  )}
                  <button
                    type="button"
                    className="weplay-guide-next"
                    disabled={saving}
                    onClick={() =>
                      step === STEPS.length - 1 ? onFinish() : setStep(step + 1)
                    }
                  >
                    {saving
                      ? "저장 중…"
                      : step === STEPS.length - 1
                        ? "안내 마치기"
                        : "다음"}
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}
