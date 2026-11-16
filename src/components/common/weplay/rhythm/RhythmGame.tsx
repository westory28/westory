import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import RhythmHelp from "./RhythmHelp";
import { useAuth } from "../../../../contexts/AuthContext";
import {
  startRhythmRankingGame,
  finishRhythmRankingGame,
  type RhythmRankingEvent,
} from "../../../../lib/weplayRanking";
import WeplayRanking from "../WeplayRanking";
import RhythmDrum from "./RhythmDrum";
import {
  RhythmBrand,
  RhythmIcon,
  RhythmMascot,
  RhythmNoteArt,
  RhythmOrientationGuide,
  rhythmAsset,
} from "./RhythmArt";
import useRhythmStage, { rhythmPointerPosition } from "./useRhythmStage";
import { RhythmAudio } from "./rhythmAudio";
import { RHYTHM_SONGS } from "./rhythmSongs";
import {
  COUNT_IN_SECONDS,
  HIT_WINDOW_SECONDS,
  applyJudgement,
  classifyDrumHit,
  createChart,
  createScore,
  judgeInput,
  type DrumKind,
  type DrumHand,
  type RhythmDifficulty,
  type RhythmJudgement,
} from "./rhythmCore";
import {
  isWeplayAudioMuted,
  onWeplayAudioMutedChange,
  setWeplayAudioMuted,
} from "../weplayAudioPreference";
import "./rhythm.css";

type Phase = "ready" | "starting" | "playing" | "paused" | "result";
const DIFFICULTIES: { id: RhythmDifficulty; name: string }[] = [
  { id: "easy", name: "중모리 장단" },
  { id: "normal", name: "자진모리 장단" },
  { id: "hard", name: "휘모리 장단" },
];
const JUDGEMENT_TEXT = {
  perfect: "지화자 좋다!",
  good: "얼씨구",
  ok: "좋다",
  miss: "어이쿠",
};
const JUDGEMENT_POINTS = { perfect: 1000, good: 650, ok: 300, miss: 0 };
const HIT_SPOTS = [
  { kind: "rim", hand: "left", x: 0.28, y: 0.12, key: "Z" },
  { kind: "rim", hand: "right", x: 0.72, y: 0.12, key: "X" },
  { kind: "center", hand: "left", x: 0.38, y: 0.32, key: "←" },
  { kind: "center", hand: "right", x: 0.62, y: 0.32, key: "→" },
] as const;
type CollectedNote = {
  id: number;
  kind: DrumKind;
  hand: DrumHand;
  grade: RhythmJudgement;
  x: number;
  y: number;
  dx: number;
  dy: number;
};

export default function RhythmGame({
  preview = false,
  playable = true,
}: {
  preview?: boolean;
  playable?: boolean;
}) {
  const { config } = useAuth();
  const rankingRun = useRef<{
    requestId: string;
    songId: string;
    difficulty: string;
    sessionId?: string;
    events: RhythmRankingEvent[];
  } | null>(null);
  const rankingSaveBusy = useRef(false);
  const [rankingSave, setRankingSave] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [songId, setSongId] = useState(RHYTHM_SONGS[0].id);
  const [difficulty, setDifficulty] = useState<RhythmDifficulty>("normal");
  const [phase, setPhase] = useState<Phase>("ready");
  const phaseRef = useRef<Phase>("ready");
  const playableRef = useRef(playable);
  playableRef.current = playable;
  const [elapsed, setElapsed] = useState(0);
  const [score, setScore] = useState(createScore);
  const [feedback, setFeedback] = useState("");
  const [feedbackGrade, setFeedbackGrade] = useState<RhythmJudgement | null>(
    null,
  );
  const [collected, setCollected] = useState<CollectedNote[]>([]);
  const [arrivalId, setArrivalId] = useState(0);
  const [handStrikes, setHandStrikes] = useState<
    Partial<Record<DrumHand, { id: number; kind: DrumKind }>>
  >({});
  const canvasRef = useRef<HTMLDivElement>(null);
  const scoreTargetRef = useRef<HTMLElement>(null);
  const [lastStrike, setLastStrike] = useState<{
    kind: DrumKind;
    at: number;
    id: number;
  } | null>(null);
  const [effects, setEffects] = useState<
    {
      id: number;
      kind: DrumKind;
      grade: RhythmJudgement | "tap";
      x: number;
      y: number;
    }[]
  >([]);
  const strikeId = useRef(0);
  const drumArtRef = useRef<HTMLDivElement>(null);
  const mascotRef = useRef<HTMLDivElement>(null);
  const [feedbackId, setFeedbackId] = useState(0);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(isWeplayAudioMuted);
  const [offset, setOffset] = useState(0);
  const audio = useRef<RhythmAudio | null>(null);
  const judged = useRef(new Set<string>());
  const blockedUntil = useRef(0);
  const scoreRef = useRef(createScore());
  const generation = useRef(0);
  const gameRef = useRef<HTMLElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const calibrationRef = useRef<HTMLDetailsElement>(null);
  const song =
    RHYTHM_SONGS.find((item) => item.id === songId) || RHYTHM_SONGS[0];
  const chart = useMemo(
    () => createChart(song, difficulty),
    [song, difficulty],
  );
  const setGamePhase = useCallback((value: Phase) => {
    phaseRef.current = value;
    setPhase(value);
  }, []);

  useEffect(() => onWeplayAudioMutedChange(setMuted), []);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const panel = calibrationRef.current;
      if (panel?.open && !panel.contains(event.target as Node))
        panel.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && calibrationRef.current?.open) {
        event.preventDefault();
        event.stopPropagation();
        calibrationRef.current.open = false;
        calibrationRef.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, []);
  useEffect(() => {
    audio.current?.setVolume(muted ? 0 : 0.65);
  }, [muted]);
  useEffect(
    () => () => {
      generation.current++;
      audio.current?.dispose();
    },
    [],
  );
  useEffect(() => {
    if (phase === "result") resultRef.current?.focus();
  }, [phase]);

  const pause = useCallback(() => {
    if (phaseRef.current !== "playing") return;
    const player = audio.current;
    const token = generation.current;
    setGamePhase("paused");
    void player?.pause().catch(() => {
      if (token !== generation.current || audio.current !== player) return;
      player.dispose();
      audio.current = null;
      setError("소리가 중단되었습니다. 곡을 다시 시작해 주세요.");
    });
  }, [setGamePhase]);
  const stage = useRhythmStage(gameRef, pause);
  const portraitRef = useRef(stage.portrait);
  portraitRef.current = stage.portrait;
  useEffect(() => {
    if (!playable) pause();
  }, [playable, pause]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) pause();
    };
    const key = (event: KeyboardEvent) => {
      if (event.code === "Escape") pause();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("blur", pause);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("blur", pause);
      window.removeEventListener("keydown", key);
    };
  }, [pause]);

  const start = async () => {
    if (
      phaseRef.current === "starting" ||
      !playableRef.current ||
      portraitRef.current
    )
      return;
    const newRun = phaseRef.current !== "ready";
    const token = ++generation.current;
    audio.current?.dispose();
    const player = new RhythmAudio();
    audio.current = player;
    judged.current = new Set();
    blockedUntil.current = 0;
    scoreRef.current = createScore();
    setScore(scoreRef.current);
    setElapsed(0);
    setFeedback("");
    setFeedbackGrade(null);
    setCollected([]);
    setHandStrikes({});
    setArrivalId(0);
    setLastStrike(null);
    setEffects([]);
    setError("");
    setGamePhase("starting");
    setRankingSave("idle");
    if (
      !preview &&
      (newRun ||
        !rankingRun.current ||
        rankingRun.current.songId !== songId ||
        rankingRun.current.difficulty !== difficulty)
    ) {
      rankingRun.current = {
        requestId: crypto.randomUUID(),
        songId,
        difficulty,
        events: [],
      };
    }
    try {
      await player.start(
        song,
        muted ? 0 : 0.65,
        preview
          ? undefined
          : async () => {
              const run = rankingRun.current!;
              const saved = await startRhythmRankingGame(config, {
                requestId: run.requestId,
                songId: run.songId,
                difficulty: run.difficulty,
              });
              if (token !== generation.current || rankingRun.current !== run)
                return false;
              run.sessionId = saved.sessionId;
              run.events = [];
              return playableRef.current;
            },
      );
      if (token !== generation.current) {
        player.dispose();
        return;
      }
      if (document.hidden || !playableRef.current || portraitRef.current) {
        await player.pause();
        if (token !== generation.current) return;
        setGamePhase("paused");
      } else setGamePhase("playing");
      gameRef.current?.focus({ preventScroll: true });
      if (!stage.fullscreen)
        gameRef.current?.scrollIntoView({
          block: "start",
          behavior: "instant",
        });
    } catch {
      if (token !== generation.current) return;
      player.dispose();
      setGamePhase("ready");
      setError(
        "연주를 시작하지 못했습니다. 연결 상태와 소리 설정을 확인한 뒤 다시 시작해 주세요.",
      );
    }
  };
  const resume = async () => {
    if (
      phaseRef.current !== "paused" ||
      !audio.current ||
      !playableRef.current ||
      portraitRef.current
    )
      return;
    const token = ++generation.current;
    const player = audio.current;
    setGamePhase("starting");
    try {
      if (token !== generation.current) return;
      if (!playableRef.current) {
        setGamePhase("paused");
        return;
      }
      await player.resume();
      if (token !== generation.current) return;
      if (document.hidden || !playableRef.current || portraitRef.current) {
        await player.pause();
        if (token !== generation.current) return;
        setGamePhase("paused");
        return;
      }
      blockedUntil.current = 0;
      setGamePhase("playing");
      setError("");
      gameRef.current?.focus({ preventScroll: true });
    } catch {
      if (token === generation.current) {
        player.dispose();
        audio.current = null;
        setGamePhase("paused");
        setError(
          "소리를 다시 시작하지 못했습니다. 곡 고르기로 돌아가 다시 시작해 주세요.",
        );
      }
    }
  };
  const saveRanking = useCallback(async () => {
    const run = rankingRun.current;
    if (preview || !run?.sessionId || rankingSaveBusy.current) return;
    rankingSaveBusy.current = true;
    setRankingSave("saving");
    try {
      await finishRhythmRankingGame(config, {
        sessionId: run.sessionId,
        events: run.events,
      });
      if (rankingRun.current === run) setRankingSave("saved");
    } catch {
      if (rankingRun.current === run) setRankingSave("error");
    } finally {
      rankingSaveBusy.current = false;
    }
  }, [preview, config?.year, config?.semester]);
  const finish = useCallback(() => {
    audio.current?.stop();
    setGamePhase("result");
    setFeedback("");
    void saveRanking();
  }, [setGamePhase, saveRanking]);
  useEffect(() => {
    if (phase !== "playing") return;
    let raf = 0;
    const tick = () => {
      if (phaseRef.current !== "playing" || !audio.current) return;
      if (audio.current.state !== "running" || !playableRef.current) {
        pause();
        return;
      }
      const time = audio.current.currentTime;
      let next = scoreRef.current;
      for (const note of chart) {
        if (note.time >= time - offset / 1000 - HIT_WINDOW_SECONDS) break;
        if (judged.current.has(note.id)) continue;
        judged.current.add(note.id);
        next = applyJudgement(next, "miss");
        setFeedback(JUDGEMENT_TEXT.miss);
        setFeedbackGrade("miss");
        setFeedbackId((value) => value + 1);
      }
      if (next !== scoreRef.current) {
        scoreRef.current = next;
        setScore(next);
      }
      setElapsed(time);
      if (time >= song.duration + Math.max(0, offset / 1000)) {
        finish();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, chart, song.duration, offset, finish, pause]);

  const strike = useCallback(
    (kind: DrumKind, hand: DrumHand, point?: { x: number; y: number }) => {
      if (
        phaseRef.current !== "playing" ||
        !playableRef.current ||
        portraitRef.current ||
        !audio.current ||
        audio.current.state !== "running"
      )
        return;
      const now = audio.current.currentTime;
      if (rankingRun.current?.sessionId)
        rankingRun.current.events.push({
          time: now - offset / 1000,
          kind,
          hand,
        });
      audio.current.hit(kind);
      const id = ++strikeId.current;
      setLastStrike({ kind, at: now, id });
      setHandStrikes((previous) => ({ ...previous, [hand]: { id, kind } }));
      const input = judgeInput(
        chart,
        judged.current,
        kind,
        hand,
        now - offset / 1000,
        blockedUntil.current,
      );
      blockedUntil.current = input.blockedUntil;
      const { note, judgement } = input;
      const grade = judgement === "ignored" ? "tap" : judgement;
      const spot = HIT_SPOTS.find(
        (item) => item.kind === kind && item.hand === hand,
      )!;
      setEffects((previous) => [
        ...previous.slice(-7),
        {
          id,
          kind,
          grade,
          x: point?.x ?? spot.x,
          y: point?.y ?? spot.y,
        },
      ]);
      if (judgement === "ignored") return;
      scoreRef.current = applyJudgement(scoreRef.current, judgement);
      setScore(scoreRef.current);
      setFeedback(JUDGEMENT_TEXT[judgement]);
      setFeedbackGrade(judgement);
      setFeedbackId((value) => value + 1);
      if (!note || judgement === "miss") return;
      const canvas = canvasRef.current;
      const source = canvas?.querySelector(`[data-note-id="${note.id}"]`);
      const target = scoreTargetRef.current;
      if (canvas && source && target) {
        const rect = canvas.getBoundingClientRect();
        const from = source.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        const origin = rhythmPointerPosition(
          rect,
          from.x + from.width / 2,
          from.y + from.height / 2,
          stage.rotated,
        );
        const destination = rhythmPointerPosition(
          rect,
          to.x + to.width / 2,
          to.y + to.height / 2,
          stage.rotated,
        );
        setCollected((items) => [
          ...items.slice(-11),
          {
            id,
            kind,
            hand,
            grade: judgement,
            x: origin.x * canvas.clientWidth,
            y: origin.y * canvas.clientHeight,
            dx: (destination.x - origin.x) * canvas.clientWidth,
            dy: (destination.y - origin.y) * canvas.clientHeight,
          },
        ]);
      }
      judged.current.add(note.id);
    },
    [chart, offset, stage.rotated],
  );
  useEffect(() => {
    if (!lastStrike) return;
    const drum = drumArtRef.current?.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.035, .95)", offset: 0.25 },
        { transform: "scale(.99, 1.025)", offset: 0.62 },
        { transform: "scale(1)" },
      ],
      { duration: 220, easing: "ease-out" },
    );
    const mascot = mascotRef.current?.animate(
      [
        { transform: "translateY(0) rotate(0)" },
        {
          transform: `translateY(-14px) rotate(${lastStrike.kind === "center" ? -8 : 8}deg)`,
          offset: 0.35,
        },
        { transform: "translateY(0) rotate(0)" },
      ],
      { duration: 320, easing: "ease-out" },
    );
    return () => {
      drum?.cancel();
      mascot?.cancel();
    };
  }, [lastStrike]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target instanceof Element &&
          event.target.closest("input,select,textarea,[contenteditable]"))
      )
        return;
      const kind =
        event.code === "ArrowLeft" || event.code === "ArrowRight"
          ? "center"
          : event.code === "KeyZ" || event.code === "KeyX"
            ? "rim"
            : null;
      if (kind && phaseRef.current === "playing") {
        event.preventDefault();
        strike(
          kind,
          event.code === "ArrowLeft" || event.code === "KeyZ"
            ? "left"
            : "right",
        );
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [strike]);

  const reset = () => {
    generation.current++;
    audio.current?.dispose();
    audio.current = null;
    blockedUntil.current = 0;
    setGamePhase("ready");
    setElapsed(0);
    setError("");
    setEffects([]);
    setCollected([]);
    setHandStrikes({});
    rankingRun.current = null;
    setRankingSave("idle");
  };
  const active =
    phase === "playing" || phase === "paused" || phase === "starting";
  const chartTime = elapsed - offset / 1000;
  const upcoming = chart.filter(
    (note) =>
      !judged.current.has(note.id) &&
      note.time - chartTime >= -HIT_WINDOW_SECONDS &&
      note.time - chartTime <= 2.4,
  );
  const accuracyTotal = Math.max(
    chart.length,
    score.perfect + score.good + score.ok + score.miss,
  );
  const accuracy = accuracyTotal
    ? Math.round(
        ((score.perfect + score.good * 0.65 + score.ok * 0.3) / accuracyTotal) *
          100,
      )
    : 0;

  return (
    <section
      ref={gameRef}
      className={`rhythm-game rhythm-game--${phase}${stage.fullscreen ? " rhythm-game--fullscreen" : ""}${stage.rotated ? " rhythm-game--rotated" : ""}`}
      style={
        {
          "--rh-canvas-width": `${stage.width}px`,
          "--rh-canvas-height": `${stage.height}px`,
          "--rh-background": `url("${rhythmAsset("bg-stage")}")`,
          "--rh-plaque": `url("${rhythmAsset("button-plaque")}")`,
          "--rh-start-plaque": `url("${rhythmAsset("start-plaque")}")`,
        } as CSSProperties
      }
      tabIndex={-1}
      aria-label="덩기덕 쿵더Rock 경기장"
    >
      <div className="rhythm-canvas" ref={canvasRef}>
        {!preview && (
          <WeplayRanking
            gameId="gungdeok-rock"
            initialCategory={`${songId}:${difficulty}`}
            disabled={
              !playable || phase === "starting" || rankingSave === "saving"
            }
            onOpen={pause}
          />
        )}
        {stage.portrait ? (
          <div className="rhythm-orientation-gate" role="status">
            <RhythmMascot />
            <h2>
              <RhythmBrand />
            </h2>
            <RhythmOrientationGuide />
            <p>가로로 돌리거나 전체 화면으로 시작하세요.</p>
            <button
              className="rhythm-primary"
              type="button"
              onClick={() => void stage.enter()}
            >
              전체 화면으로 열기
            </button>
          </div>
        ) : (
          <>
            <div className="rhythm-stage-top">
              <span className="rhythm-eyebrow">
                {preview ? "교사 미리보기" : "덩기덕 쿵더Rock"}
              </span>
              <div className="rhythm-stage-tools">
                {phase === "ready" && (
                  <details className="rhythm-calibration" ref={calibrationRef}>
                    <summary
                      className="rhythm-tool rhythm-icon-button"
                      aria-label="소리·판정 시차"
                    >
                      ±
                    </summary>
                    <div className="rhythm-calibration-popover">
                      <label htmlFor="rhythm-offset">
                        판정 시차 {offset > 0 ? "+" : ""}
                        {offset}ms
                      </label>
                      <input
                        id="rhythm-offset"
                        type="range"
                        min={-250}
                        max={250}
                        step={10}
                        value={offset}
                        onChange={(event) =>
                          setOffset(Number(event.target.value))
                        }
                      />
                      <p>늦게 맞으면 +, 일찍 맞으면 − 방향으로 조절하세요.</p>
                    </div>
                  </details>
                )}
                <RhythmHelp
                  label="리듬 게임 조작 방법"
                  sections={[
                    {
                      title: "쿵 · 덕",
                      text: "주홍 동그라미는 북 가운데, 남색 마름모는 북 가장자리입니다. 오른쪽에서 오는 노트가 왼쪽 장단꽃에 닿을 때 치세요.",
                    },
                    {
                      title: "키보드",
                      text: "노트의 왼·오에 맞춰 치세요. ← / Z는 왼손, → / X는 오른손입니다. 방향키는 가운데, Z / X는 가장자리입니다. 모바일은 북 위의 원을 누르세요. Escape는 일시정지, Enter와 Space는 선택한 북 버튼입니다.",
                    },
                    {
                      title: "소리와 판정",
                      text: "소리가 늦게 들리면 시작 전에 판정 시차를 조절하세요. 점수는 이번 연주에만 표시됩니다.",
                    },
                    {
                      title: "판정과 점수",
                      text: "지화자 좋다! 1,000점 · 얼씨구 650점 · 좋다 300점. 잘못 치거나 놓치면 어이쿠, 콤보가 끊깁니다. 연타를 멈추고 다음 박자에 맞춰 치세요.",
                    },
                  ]}
                />
                <button
                  type="button"
                  className="rhythm-tool rhythm-icon-button"
                  onClick={() => setWeplayAudioMuted(!muted)}
                  aria-label={muted ? "소리 켜기" : "소리 끄기"}
                  aria-pressed={muted}
                >
                  <RhythmIcon name={muted ? "muted" : "sound"} />
                </button>
                {phase === "playing" && (
                  <button
                    type="button"
                    className="rhythm-tool rhythm-icon-button"
                    onClick={pause}
                    aria-label="일시정지"
                  >
                    <RhythmIcon name="pause" />
                  </button>
                )}
                <button
                  type="button"
                  className="rhythm-tool rhythm-icon-button rhythm-fullscreen"
                  onClick={() =>
                    stage.fullscreen ? stage.exit() : void stage.enter()
                  }
                  aria-label={
                    stage.fullscreen ? "전체 화면 나가기" : "전체 화면"
                  }
                >
                  <RhythmIcon name={stage.fullscreen ? "collapse" : "expand"} />
                </button>
              </div>
            </div>
            {error && (
              <p className="rhythm-error" role="alert">
                {error}
              </p>
            )}
            {phase === "ready" ? (
              <div className="rhythm-lobby">
                <div className="rhythm-entry-scene">
                  <h2>
                    <RhythmBrand />
                  </h2>
                  <RhythmMascot />
                  <div className="rhythm-entry-notes" aria-hidden="true">
                    <RhythmNoteArt kind="center" />
                    <RhythmNoteArt kind="rim" />
                  </div>
                  <div className="rhythm-drum-legend">
                    <span>
                      <RhythmNoteArt kind="center" />
                      <b>가운데</b>
                      <kbd>← →</kbd>
                    </span>
                    <span>
                      <RhythmNoteArt kind="rim" />
                      <b>가장자리</b>
                      <kbd>Z X</kbd>
                    </span>
                  </div>
                </div>
                <div className="rhythm-song-panel">
                  <fieldset className="rhythm-songs">
                    <legend>오늘의 장단</legend>
                    {RHYTHM_SONGS.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className="rhythm-song"
                        aria-pressed={song.id === item.id}
                        onClick={() => setSongId(item.id)}
                      >
                        <span className="rhythm-song-name">
                          <strong>{item.title}</strong>
                        </span>
                        {song.id === item.id && (
                          <svg
                            className="rhythm-song-check"
                            width="26"
                            height="26"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="m5 12 4 4L19 6" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </fieldset>
                  <fieldset className="rhythm-difficulty">
                    <legend>장단</legend>
                    {DIFFICULTIES.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => setDifficulty(item.id)}
                        aria-pressed={difficulty === item.id}
                      >
                        {item.name}
                      </button>
                    ))}
                  </fieldset>
                  <div className="rhythm-start-row">
                    <button
                      type="button"
                      className="rhythm-primary rhythm-start-button"
                      disabled={!playable}
                      onClick={() => void start()}
                    >
                      연주 시작 <RhythmIcon name="play" />
                    </button>
                  </div>
                </div>
              </div>
            ) : phase === "result" ? (
              <div className="rhythm-result">
                <RhythmMascot />
                <div className="rhythm-result-paper">
                  <span className="rhythm-eyebrow">{song.title}</span>
                  <h2 ref={resultRef} tabIndex={-1}>
                    한 판, 얼쑤!
                  </h2>
                  <strong className="rhythm-result-score">
                    {score.score.toLocaleString()}
                    <small>점</small>
                  </strong>
                  <dl>
                    {[
                      ["정확도", `${accuracy}%`, ""],
                      ["최대 이어치기", score.maxCombo, ""],
                      ["지화자 좋다!", score.perfect, "perfect"],
                      ["얼씨구", score.good, "good"],
                      ["좋다", score.ok, "ok"],
                      ["어이쿠", score.miss, "miss"],
                    ].map(([label, value, grade]) => (
                      <div key={label}>
                        <dt data-grade={grade || undefined}>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="rhythm-result-actions">
                    <button
                      type="button"
                      className="rhythm-tool"
                      onClick={reset}
                      disabled={rankingSave === "saving"}
                    >
                      곡 고르기
                    </button>
                    <button
                      type="button"
                      className="rhythm-primary"
                      disabled={!playable || rankingSave === "saving"}
                      onClick={() => void start()}
                    >
                      한 번 더
                    </button>
                  </div>
                  {!preview && rankingSave === "saving" && (
                    <p role="status">기록을 저장하고 있습니다.</p>
                  )}
                  {!preview && rankingSave === "error" && (
                    <div role="alert">
                      <p>기록을 저장하지 못했습니다.</p>
                      <button
                        type="button"
                        className="rhythm-tool"
                        onClick={() => void saveRanking()}
                      >
                        기록 다시 저장
                      </button>
                    </div>
                  )}
                </div>
                <div className="rhythm-confetti" aria-hidden="true">
                  {Array.from({ length: 12 }, (_, index) => (
                    <i key={index} style={{ "--i": index } as CSSProperties} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="rhythm-performance">
                <div className="rhythm-scorebar">
                  <div>
                    <span>{song.title}</span>
                    <strong
                      ref={scoreTargetRef}
                      key={arrivalId}
                      className={arrivalId ? "rhythm-score-arrival" : ""}
                    >
                      {score.score.toLocaleString()}
                      <small>점</small>
                    </strong>
                  </div>
                  <div className="rhythm-combo" data-hot={score.combo >= 10}>
                    <span>이어치기</span>
                    <strong key={score.combo}>
                      {score.combo}
                      <small>콤보</small>
                    </strong>
                  </div>
                </div>
                <progress
                  className="rhythm-progress"
                  value={Math.max(0, elapsed - COUNT_IN_SECONDS)}
                  max={song.duration - COUNT_IN_SECONDS}
                  aria-label="연주 진행"
                />
                <div className="rhythm-play-field">
                  <div className="rhythm-lane-wrap">
                    <div
                      className="rhythm-lanes"
                      role="img"
                      aria-label="오른쪽에서 왼쪽으로 오는 한 줄 악보: 주홍 쿵, 남색 덕"
                    >
                      <div className="rhythm-lane-thread" />
                      <div className="rhythm-hit-line">
                        <svg viewBox="0 0 100 100" aria-hidden="true">
                          <path d="M50 5Q63 18 70 12Q72 28 88 30Q82 42 95 50Q82 63 88 70Q72 72 70 88Q58 82 50 95Q37 82 30 88Q28 72 12 70Q18 58 5 50Q18 37 12 30Q28 28 30 12Q42 18 50 5Z" />
                          <circle cx="50" cy="50" r="28" />
                          <circle cx="50" cy="50" r="20" />
                        </svg>
                      </div>
                      {upcoming.map((note) => (
                        <div
                          key={note.id}
                          data-kind={note.kind}
                          data-hand={note.hand}
                          data-note-id={note.id}
                          className={`rhythm-note rhythm-note--${note.kind}`}
                          style={{
                            left: `${14 + ((note.time - chartTime) / 2.4) * 78}%`,
                          }}
                        >
                          <RhythmNoteArt kind={note.kind} />
                          <b className="rhythm-note-hand">
                            {note.hand === "left" ? "왼" : "오"}
                          </b>
                          <span>{note.kind === "center" ? "쿵" : "덕"}</span>
                        </div>
                      ))}
                      {lastStrike && (
                        <div
                          key={lastStrike.id}
                          className={`rhythm-target-ripple rhythm-target-ripple--${lastStrike.kind}`}
                        />
                      )}
                    </div>
                    <div className="rhythm-lane-caption" aria-hidden="true">
                      <span>장단꽃에 맞춰요</span>
                      <span>← 장단이 와요</span>
                    </div>
                  </div>
                  <div className="rhythm-drum-zone">
                    <div className="rhythm-stage-mascot" ref={mascotRef}>
                      <RhythmMascot />
                    </div>
                    <div
                      key={feedbackId}
                      className={`rhythm-feedback rhythm-feedback--${feedbackGrade || "count"}`}
                      data-grade={feedbackGrade}
                      aria-hidden="true"
                    >
                      {elapsed < COUNT_IN_SECONDS
                        ? Math.max(1, Math.ceil(COUNT_IN_SECONDS - elapsed))
                        : feedback}
                      {elapsed >= COUNT_IN_SECONDS &&
                        feedbackGrade &&
                        feedbackGrade !== "miss" && (
                          <small>
                            +{JUDGEMENT_POINTS[feedbackGrade].toLocaleString()}
                          </small>
                        )}
                    </div>
                    {score.combo > 0 && score.combo % 10 === 0 && (
                      <div
                        key={score.combo}
                        className="rhythm-combo-cheer"
                        aria-hidden="true"
                      >
                        {score.combo}연속, 신명 난다!
                      </div>
                    )}
                    <div className="rhythm-drum-crop">
                      <div className="rhythm-play-drum">
                        <div ref={drumArtRef} className="rhythm-drum-visual">
                          <RhythmDrum />
                        </div>
                        <div
                          className="rhythm-drum-touch"
                          onKeyDown={(event) => {
                            if (
                              event.repeat &&
                              (event.code === "Enter" || event.code === "Space")
                            )
                              event.preventDefault();
                          }}
                          onPointerDown={(event) => {
                            if (
                              event.pointerType === "mouse" &&
                              event.button !== 0
                            )
                              return;
                            const point = rhythmPointerPosition(
                              event.currentTarget.getBoundingClientRect(),
                              event.clientX,
                              event.clientY,
                              stage.rotated,
                            );
                            const hitButton = (
                              event.target as Element
                            ).closest<HTMLButtonElement>("[data-hit-kind]");
                            const kind = hitButton
                              ? (hitButton.dataset.hitKind as DrumKind)
                              : classifyDrumHit(point.x, point.y);
                            if (kind) {
                              event.preventDefault();
                              if (hitButton) {
                                strike(
                                  hitButton.dataset.hitKind as DrumKind,
                                  hitButton.dataset.hand as DrumHand,
                                );
                              } else
                                strike(
                                  kind,
                                  point.x < 0.5 ? "left" : "right",
                                  point,
                                );
                            }
                          }}
                        >
                          {HIT_SPOTS.map((spot) => (
                            <button
                              key={`${spot.hand}-${spot.kind}`}
                              type="button"
                              className={`rhythm-hit-spot rhythm-${spot.kind}-button`}
                              data-hit-kind={spot.kind}
                              data-hand={spot.hand}
                              style={{
                                left: `${spot.x * 100}%`,
                                top: `${spot.y * 100}%`,
                              }}
                              aria-label={`${spot.hand === "left" ? "왼손" : "오른손"} ${spot.kind === "center" ? "가운데 쿵" : "가장자리 덕"} (${spot.key})`}
                              disabled={phase !== "playing" || !playable}
                              onClick={(event) => {
                                if (event.detail === 0)
                                  strike(spot.kind, spot.hand);
                              }}
                            >
                              <span>
                                {spot.hand === "left" ? "왼" : "오"}
                                <small>
                                  {spot.kind === "center" ? "쿵" : "덕"}
                                </small>
                                <kbd>{spot.key}</kbd>
                              </span>
                            </button>
                          ))}
                        </div>
                        <div className="rhythm-hit-effects" aria-hidden="true">
                          {effects.map((effect) => (
                            <div
                              key={effect.id}
                              className={`rhythm-hit-effect rhythm-hit-effect--${effect.kind} rhythm-hit-effect--${effect.grade}`}
                              data-grade={effect.grade}
                              style={{
                                left: `${effect.x * 100}%`,
                                top: `${effect.y * 100}%`,
                              }}
                              onAnimationEnd={(event) => {
                                if (event.target === event.currentTarget)
                                  setEffects((items) =>
                                    items.filter(
                                      (item) => item.id !== effect.id,
                                    ),
                                  );
                              }}
                            >
                              <i className="rhythm-shockwave" />
                              {effect.grade === "perfect" && (
                                <i className="rhythm-shockwave rhythm-shockwave--echo" />
                              )}
                              <b>
                                {effect.grade === "miss"
                                  ? "×"
                                  : effect.kind === "center"
                                    ? "쿵!"
                                    : "덕!"}
                              </b>
                              {Array.from(
                                {
                                  length:
                                    effect.grade === "perfect"
                                      ? 12
                                      : effect.grade === "good"
                                        ? 6
                                        : effect.grade === "ok"
                                          ? 3
                                          : 0,
                                },
                                (_, index) => (
                                  <i
                                    key={index}
                                    className="rhythm-spark"
                                    style={
                                      {
                                        "--angle": `${index * (360 / (effect.grade === "perfect" ? 12 : effect.grade === "good" ? 6 : 3))}deg`,
                                        "--travel": `${36 + (index % 3) * 18}px`,
                                      } as CSSProperties
                                    }
                                  />
                                ),
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="rhythm-mallets" aria-hidden="true">
                      {(["left", "right"] as const).map((hand) => (
                        <div
                          className={`rhythm-mallet-position rhythm-mallet-position--${hand}`}
                          key={hand}
                        >
                          <img
                            key={handStrikes[hand]?.id || 0}
                            className={`rhythm-mallet rhythm-mallet--${hand}${handStrikes[hand] ? " rhythm-mallet--striking" : ""}`}
                            data-kind={handStrikes[hand]?.kind || "center"}
                            data-strike-id={handStrikes[hand]?.id || 0}
                            src={rhythmAsset(`mallet-${hand}`)}
                            alt=""
                            width={320}
                            height={512}
                            draggable={false}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="rhythm-play-legend">
                      <span>
                        <RhythmNoteArt kind="center" />
                        <b>가운데 쿵</b>
                        <kbd>← →</kbd>
                      </span>
                      <span>
                        <RhythmNoteArt kind="rim" />
                        <b>가장자리 덕</b>
                        <kbd>Z X</kbd>
                      </span>
                    </div>
                  </div>
                </div>
                {(phase === "paused" || phase === "starting") && (
                  <div className="rhythm-pause">
                    <RhythmMascot />
                    <h2>
                      {phase === "starting"
                        ? "장단을 준비하고 있어요"
                        : "잠시 쉬어 가요"}
                    </h2>
                    {phase === "paused" && (
                      <div>
                        <button
                          type="button"
                          className="rhythm-primary"
                          disabled={!playable || !audio.current}
                          onClick={() => void resume()}
                        >
                          계속 연주
                        </button>
                        <button
                          type="button"
                          className="rhythm-tool"
                          onClick={reset}
                        >
                          곡 고르기
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <span className="rhythm-sr-only" aria-live="polite">
                  {active
                    ? phase === "paused"
                      ? "연주를 일시정지했습니다."
                      : "연주 중입니다."
                    : ""}
                </span>
              </div>
            )}
          </>
        )}
        <div className="rhythm-collection-layer" aria-hidden="true">
          {collected.map((note) => (
            <div
              key={note.id}
              className={`rhythm-collected-note rhythm-collected-note--${note.grade}`}
              data-grade={note.grade}
              style={
                {
                  left: note.x,
                  top: note.y,
                  "--collect-x": `${note.dx}px`,
                  "--collect-y": `${note.dy}px`,
                } as CSSProperties
              }
              onAnimationEnd={(event) => {
                if (event.target !== event.currentTarget) return;
                setCollected((items) =>
                  items.filter((item) => item.id !== note.id),
                );
                setArrivalId(note.id);
              }}
            >
              <RhythmNoteArt kind={note.kind} />
              <b className="rhythm-note-hand">
                {note.hand === "left" ? "왼" : "오"}
              </b>
              <strong>+{JUDGEMENT_POINTS[note.grade].toLocaleString()}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
