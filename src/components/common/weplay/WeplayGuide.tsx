import { useEffect, useId, useRef, useState } from "react";
import NavalBattleGame from "./NavalBattleGame";
import {
  DEFAULT_WEPLAY_DIFFICULTIES,
  type WeplaySession,
  type WeplayLobby,
} from "../../../lib/weplay";
import { DEFAULT_WEPLAY_GAME_TITLE } from "../../../lib/weplayTitle";
import "./weplay-guide.css";
import WeplayGuideRules from "./WeplayGuideRules";

const STEPS = [
  {
    target: "input",
    wordId: "guide-1",
    title: "거북선을 입력해 보세요",
    text: "아래 칸에 쓰고 장전 또는 Enter를 누르세요.",
  },
  {
    target: "charge",
    wordId: "guide-2",
    title: "한 단어 더 맞히면 화포 발사",
    text: "이번에는 이순신을 입력해 보세요.",
  },
  {
    target: "special",
    wordId: "guide-3",
    title: "긴 단어로 필살기를 써 보세요",
    text: "실전에서는 5초 안에 입력해요.",
  },
  {
    target: "complete",
    wordId: null,
    title: "출전할 준비가 됐어요!",
    text: "장전부터 필살기까지 모두 해냈어요.",
  },
] as const;
const DEMO: WeplaySession = {
  id: "weplay-guide-demo",
  difficulty: "mild",
  mode: "practice",
  status: "active",
  startsAtMs: 100000,
  serverNowMs: 102000,
  endsAtMs: 190000,
  battleVersion: 1,
  acceptedWordIds: [],
  acceptedEvents: [],
  correctCount: 0,
  difficultySettings: DEFAULT_WEPLAY_DIFFICULTIES.mild,
  words: ["거북선", "이순신", "천상열차분야지도"].map((text, index) => ({
    id: `guide-${index + 1}`,
    text,
    unitId: "guide",
    lessonTitle: "게임 안내",
    context: "",
    stage: 1,
    spawnAtMs: 0,
    fallDurationMs: index === 2 ? 5000 : 12000,
    kind: index === 2 ? "special" : "normal",
    ...(index === 2 ? { tactic: "crane-wing" as const } : {}),
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
  rules?: WeplayLobby | null;
  onFinish: () => void;
  onCloseForNow: () => void;
}

export default function WeplayGuide({
  gameTitle = DEFAULT_WEPLAY_GAME_TITLE,
  open,
  saving,
  error,
  gameRunning = false,
  rules,
  onFinish,
  onCloseForNow,
}: Props) {
  const [step, setStep] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [wrong, setWrong] = useState(false);
  const [run, setRun] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(
    window.visualViewport?.height || window.innerHeight,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const transition = useRef<ReturnType<typeof setTimeout>>();
  const titleId = useId();
  const descriptionId = useId();
  const feedbackId = useId();
  const selected = STEPS[step];
  const reset = () => {
    clearTimeout(transition.current);
    setStep(0);
    setWaiting(false);
    setFeedback("");
    setWrong(false);
    setRun((value) => value + 1);
  };
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      returnTo.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      reset();
      element.showModal();
      heading.current?.focus({ preventScroll: true });
    } else if (!open && element.open) {
      clearTimeout(transition.current);
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
    return () => clearTimeout(transition.current);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    const resize = () =>
      setViewportHeight(viewport?.height || window.innerHeight);
    resize();
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);
  useEffect(() => {
    if (error) retry.current?.focus({ preventScroll: true });
  }, [error]);
  useEffect(() => {
    if (!open) return;
    const input = dialog.current?.querySelector<HTMLInputElement>(
      ".naval-input-frame input",
    );
    input?.setAttribute("aria-describedby", `${descriptionId} ${feedbackId}`);
    input?.setAttribute("aria-invalid", String(wrong));
  }, [open, run, wrong, descriptionId, feedbackId]);
  const attempt = (accepted: boolean) => {
    if (waiting || saving || error) return;
    setWrong(!accepted);
    if (!accepted) {
      setFeedback("화면의 단어를 확인하고 다시 입력해 보세요.");
      return;
    }
    if (step === 0) {
      setFeedback("장전 완료! 포탄이 한 칸 채워졌어요.");
      setStep(1);
    } else {
      setWaiting(true);
      setFeedback(
        step === 1
          ? "화포 발사! 적 체력이 줄었어요."
          : "학익진 발동! 필살기 성공이에요.",
      );
      transition.current = setTimeout(
        () => {
          setWaiting(false);
          setStep(step + 1);
          requestAnimationFrame(() => {
            if (step === 1)
              dialog.current
                ?.querySelector<HTMLInputElement>(".naval-input-frame input")
                ?.focus({ preventScroll: true });
            else heading.current?.focus({ preventScroll: true });
          });
        },
        step === 1 ? 1800 : 2700,
      );
    }
  };
  return (
    <dialog
      ref={dialog}
      className={`weplay-guide${viewportHeight < 560 ? " is-compact" : ""}`}
      style={
        {
          "--guide-visible-height": `${viewportHeight}px`,
        } as React.CSSProperties
      }
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
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), summary, [href], [tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0],
          last = controls[controls.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === heading.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      {open && (
        <>
          <header className="weplay-guide-header">
            <div>
              <strong>게임 안내</strong>
              <span>{gameTitle}</span>
            </div>
            <ol
              className="weplay-guide-progress"
              aria-label="직접 해 보기 진행 단계"
            >
              {["장전", "화포", "필살기"].map((label, index) => (
                <li
                  key={label}
                  aria-current={step === index ? "step" : undefined}
                  className={step > index ? "is-done" : ""}
                >
                  <span aria-hidden="true">
                    {step > index ? "✓" : index + 1}
                  </span>
                  {label}
                </li>
              ))}
            </ol>
          </header>
          {rules && <WeplayGuideRules lobby={rules} />}
          {gameRunning && (
            <p className="weplay-guide-live" role="status">
              진행 중인 전투의 시간은 계속 흐릅니다.
            </p>
          )}
          <div className="weplay-guide-coach">
            <h2 ref={heading} tabIndex={-1} id={titleId}>
              {selected.title}
            </h2>
            <p id={descriptionId}>{selected.text}</p>
            <p
              id={feedbackId}
              className={`weplay-guide-feedback${wrong ? " is-wrong" : ""}`}
              role="status"
              aria-live="polite"
            >
              {feedback || "안내에서는 시간 제한과 위스 변동이 없어요."}
            </p>
          </div>
          <div
            className="weplay-guide-demo weplay-page"
            data-guide-step={waiting ? "effect" : selected.target}
            aria-label="시간과 위스 변동 없는 게임 체험"
          >
            <NavalBattleGame
              key={run}
              gameTitle={gameTitle}
              session={DEMO}
              config={null}
              onComplete={() => undefined}
              guideDemo
              guideInteractive={{
                wordId: waiting || saving || error ? null : selected.wordId,
                onAttempt: attempt,
              }}
            />
            {step === 3 && (
              <div className="weplay-guide-complete" aria-hidden="true">
                <span>✓</span>
                <strong>장전 · 화포 · 필살기</strong>
              </div>
            )}
          </div>
          <div className="weplay-guide-card">
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
                    {saving ? "저장 중…" : "건너뛰기"}
                  </button>
                  {step === 3 && (
                    <>
                      <button type="button" onClick={reset} disabled={saving}>
                        다시 체험
                      </button>
                      <button
                        type="button"
                        className="weplay-guide-next"
                        onClick={onFinish}
                        disabled={saving}
                      >
                        {saving ? "저장 중…" : "안내 마치기"}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}
