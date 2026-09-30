import React, { useEffect, useRef, useState } from "react";
import NavalBattleGame from "./NavalBattleGame";
import WeplayExitDialog from "./WeplayExitDialog";
import {
  finishWeplayGame,
  normalizeWeplayAnswer,
  submitWeplayAnswer,
  weplayErrorMessage,
  WEPLAY_DIFFICULTY_LABELS,
  type WeplayConfig,
  type WeplayResult,
  type WeplaySession,
  type WeplayAnswerResponse,
  type WeplayFinishOptions,
} from "../../../lib/weplay";

export interface HistoryRainTransport {
  answer: (data: {
    sessionId: string;
    eventId: string;
    wordId: string;
    answer: string;
  }) => Promise<WeplayAnswerResponse>;
  finish: (options?: WeplayFinishOptions) => Promise<WeplayResult>;
}

export interface HistoryRainGameProps {
  session: WeplaySession;
  config: WeplayConfig;
  onComplete: (result: WeplayResult) => void;
  preview?: boolean;
  transport?: HistoryRainTransport;
  onShowGuide?: () => void;
  guideDemo?: boolean;
}

export default function HistoryRainGame({ ...props }: HistoryRainGameProps) {
  return props.session.battleVersion === 1 ? (
    <NavalBattleGame {...props} />
  ) : (
    <LegacyHistoryRainGame {...props} />
  );
}

function LegacyHistoryRainGame({
  session,
  config,
  onComplete,
  preview = false,
  transport,
}: HistoryRainGameProps) {
  const [now, setNow] = useState(session.serverNowMs);
  const clock = useRef({
    server: session.serverNowMs,
    local: performance.now(),
  });
  const [accepted, setAccepted] = useState(
    () => new Set(session.acceptedWordIds),
  );
  const acceptedRef = useRef(accepted);
  const pending = useRef(new Set<string>());
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitRequested, setExitRequested] = useState(false);
  const [exitError, setExitError] = useState("");
  const exitOpenRef = useRef(false);
  const exitRequestedRef = useRef(false);
  const finishOnce = useRef(false);
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const [fieldHeight, setFieldHeight] = useState(320);
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const alive = useRef(true);
  const finishRef = useRef<(options?: WeplayFinishOptions) => void>(
    () => undefined,
  );
  useEffect(() => {
    alive.current = true;
    const timer = window.setInterval(
      () =>
        setNow(clock.current.server + performance.now() - clock.current.local),
      50,
    );
    const observer = new ResizeObserver((entries) =>
      setFieldHeight(entries[0].contentRect.height),
    );
    if (field.current) observer.observe(field.current);
    input.current?.focus();
    return () => {
      alive.current = false;
      clearInterval(timer);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const elapsed = now - session.startsAtMs;
  const remaining = Math.max(
    0,
    Math.ceil((session.endsAtMs - Math.max(now, session.startsAtMs)) / 1000),
  );
  const stageDuration = Math.max(
    1,
    (session.endsAtMs - session.startsAtMs) / 3,
  );
  const stage = Math.min(
    3,
    Math.max(1, Math.floor(elapsed / stageDuration) + 1),
  );
  const started = elapsed >= 0;
  const ended = now >= session.endsAtMs;
  useEffect(() => {
    if (started && !ended && !exitOpenRef.current) input.current?.focus();
  }, [started, ended]);
  const visible = session.words.filter(
    (word) =>
      !accepted.has(word.id) &&
      elapsed >= word.spawnAtMs &&
      elapsed < word.spawnAtMs + word.fallDurationMs &&
      !ended,
  );
  const finish = async (options?: WeplayFinishOptions) => {
    if (finishingRef.current) return;
    if (exitOpenRef.current) {
      exitRequestedRef.current = true;
      setExitRequested(true);
    }
    finishingRef.current = true;
    setFinishing(true);
    setError("");
    setExitError("");
    try {
      const result = await (transport
        ? transport.finish(options)
        : finishWeplayGame(config, session.id, options));
      if (alive.current) onComplete(result);
    } catch (caught) {
      if (alive.current)
        (exitRequestedRef.current ? setExitError : setError)(
          weplayErrorMessage(
            caught,
            "결과를 저장하지 못했습니다. 정산을 다시 시도해 주세요.",
          ),
        );
    } finally {
      finishingRef.current = false;
      if (alive.current) setFinishing(false);
    }
  };
  finishRef.current = (options) => void finish(options);
  useEffect(() => {
    if ((!ended && !exitRequested) || finishOnce.current) return;
    // Finish only after answer calls have returned, including their retries.
    let timer: ReturnType<typeof setTimeout>;
    const settleWhenReady = () => {
      if (pending.current.size > 0) timer = setTimeout(settleWhenReady, 250);
      else {
        finishOnce.current = true;
        finishRef.current(
          exitRequestedRef.current ? { exitEarly: true } : undefined,
        );
      }
    };
    timer = setTimeout(settleWhenReady, exitRequested ? 0 : 1000);
    return () => clearTimeout(timer);
  }, [ended, exitRequested]);

  const cancelExit = () => {
    if (exitRequestedRef.current) return;
    exitOpenRef.current = false;
    setExitOpen(false);
    requestAnimationFrame(() => {
      if (!ended) input.current?.focus({ preventScroll: true });
    });
  };
  const confirmExit = () => {
    if (exitRequestedRef.current) {
      if (exitError) void finish({ exitEarly: true });
      return;
    }
    exitRequestedRef.current = true;
    setExitRequested(true);
    if (finishOnce.current && !finishingRef.current)
      void finish({ exitEarly: true });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      composing.current ||
      !started ||
      ended ||
      exitOpenRef.current ||
      exitRequestedRef.current
    )
      return;
    const value = normalizeWeplayAnswer(answer);
    const word = visible.find(
      (item) =>
        normalizeWeplayAnswer(item.text) === value &&
        !pending.current.has(item.id) &&
        !acceptedRef.current.has(item.id),
    );
    if (!word) {
      setFeedback("화면에 있는 단어를 확인해 주세요.");
      return;
    }
    pending.current.add(word.id);
    setAnswer("");
    setFeedback("");
    setError("");
    try {
      const data = {
        sessionId: session.id,
        eventId: crypto.randomUUID(),
        wordId: word.id,
        answer,
      };
      const response = await (transport
        ? transport.answer(data)
        : submitWeplayAnswer(config, data));
      if (!alive.current) return;
      // Responses can arrive out of order; accepted words only accumulate.
      const next = new Set([
        ...acceptedRef.current,
        ...response.acceptedWordIds,
      ]);
      acceptedRef.current = next;
      setAccepted(next);
      if (!response.accepted)
        setFeedback("입력 시간이 지났습니다. 다음 단어에 도전해 주세요.");
    } catch (caught) {
      if (alive.current)
        setError(
          weplayErrorMessage(
            caught,
            "입력을 확인하지 못했습니다. 단어가 남아 있으면 다시 입력해 주세요.",
          ),
        );
    } finally {
      pending.current.delete(word.id);
    }
    if (!exitOpenRef.current && !exitRequestedRef.current)
      input.current?.focus();
  };
  return (
    <section className="weplay-game" aria-label="역사가 내려와 게임">
      <div className="weplay-game-meta">
        <strong>
          {preview
            ? "교사 체험"
            : session.mode === "practice"
              ? "연습"
              : "위스 도전"}
        </strong>
        <span>{WEPLAY_DIFFICULTY_LABELS[session.difficulty]}</span>
        <span role="status">{["초반", "중반", "후반"][stage - 1]}</span>
        <span>{remaining}초</span>
        <span>
          성공 {accepted.size} / {session.words.length}
        </span>
      </div>
      <ol className="weplay-stages" aria-label="진행 구간">
        {[1, 2, 3].map((value) => (
          <li key={value} aria-current={stage === value ? "step" : undefined}>
            <strong>{["초반", "중반", "후반"][value - 1]}</strong>
            <span>
              {value === 1 ? "천천히" : value === 2 ? "빠르게" : "더 빠르게"}
            </span>
          </li>
        ))}
      </ol>
      <div
        ref={field}
        className={`weplay-field${reducedMotion ? " is-still" : ""}`}
        aria-label="입력할 단어"
      >
        {!started && (
          <div className="weplay-field-message" role="status">
            {Math.ceil(-elapsed / 1000)}초 후 시작
          </div>
        )}
        {ended && (
          <div className="weplay-field-message" role="status">
            {finishing ? "결과 확인 중…" : "게임 종료"}
          </div>
        )}
        {visible.map((word) => {
          const progress = (elapsed - word.spawnAtMs) / word.fallDurationMs;
          const index = session.words.indexOf(word);
          return (
            <div
              className="weplay-word"
              key={word.id}
              style={
                reducedMotion
                  ? undefined
                  : {
                      left: `${((index % 3) * 100) / 3}%`,
                      transform: `translateY(${Math.max(0, fieldHeight - 72) * progress}px)`,
                    }
              }
            >
              <span>{word.text}</span>
              {reducedMotion && (
                <small>
                  {Math.max(
                    1,
                    Math.ceil(
                      (word.spawnAtMs + word.fallDurationMs - elapsed) / 1000,
                    ),
                  )}
                  초
                </small>
              )}
            </div>
          );
        })}
      </div>
      <form className="weplay-answer" onSubmit={(event) => void submit(event)}>
        <label htmlFor="weplay-answer-input">단어 입력</label>
        <div>
          <input
            id="weplay-answer-input"
            ref={input}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={!started || ended || exitRequested}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (composing.current ||
                  event.nativeEvent.isComposing ||
                  event.keyCode === 229)
              )
                event.preventDefault();
            }}
          />
          <button
            type="submit"
            className="weplay-primary"
            disabled={!started || ended || exitRequested || !answer.trim()}
          >
            입력
          </button>
        </div>
      </form>
      <div className="weplay-game-footer">
        <button
          className="weplay-exit-button"
          type="button"
          disabled={finishing || exitRequested}
          onClick={() => {
            exitOpenRef.current = true;
            setExitOpen(true);
          }}
        >
          나가기
        </button>
        <label>
          <input
            type="checkbox"
            checked={reducedMotion}
            onChange={(event) => setReducedMotion(event.target.checked)}
          />{" "}
          움직임 줄이기
        </label>
        <span>
          {preview
            ? "위스·랭킹·학생 기록에 반영되지 않습니다."
            : session.mode === "practice"
              ? "위스 변동 없음"
              : `도전 비용 ${session.policy.challengeCost}위스`}
        </span>
      </div>
      <WeplayExitDialog
        open={exitOpen}
        confirmed={exitRequested}
        error={exitError}
        preview={preview}
        mode={session.mode}
        onCancel={cancelExit}
        onConfirm={confirmExit}
      />
      {feedback && <p role="status">{feedback}</p>}
      {error && (
        <p className="weplay-error" role="alert">
          {error}
        </p>
      )}
      {ended && error && (
        <button
          type="button"
          onClick={() => void finish()}
          disabled={finishing}
          className="weplay-primary"
        >
          {finishing ? "확인 중…" : "정산 다시 시도"}
        </button>
      )}
    </section>
  );
}
