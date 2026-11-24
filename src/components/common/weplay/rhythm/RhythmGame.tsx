import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import RhythmHelp from "./RhythmHelp";
import { useAuth } from "../../../../contexts/AuthContext";
import {
  startRhythmRankingGame,
  finishRhythmRankingGame,
  getRhythmChallengeState,
  type RhythmChallengeState,
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
  advanceMissedNotes,
  FEVER_BONUSES,
  getFeverTier,
  classifyDrumHit,
  createChart,
  createScore,
  judgeInput,
  type DrumKind,
  type DrumHand,
  type RhythmDifficulty,
  type RhythmJudgement,
  type RhythmNote,
} from "./rhythmCore";
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
  points: number;
};

/** Only note membership uses React; the audio clock moves the visible notes. */
const RhythmLaneNotes = memo(function RhythmLaneNotes({
  chart,
  audio,
  judged,
  phase,
  offset,
  travelSeconds,
}: {
  chart: RhythmNote[];
  audio: MutableRefObject<RhythmAudio | null>;
  judged: MutableRefObject<Set<string>>;
  phase: Phase;
  offset: number;
  travelSeconds: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const width = useRef(0);
  const time = useRef(0);
  const visible = useRef<RhythmNote[]>([]);
  const [notes, setNotes] = useState<RhythmNote[]>([]);
  const position = (node: HTMLDivElement, note: RhythmNote) => {
    const x =
      width.current *
      (0.14 + ((note.time - time.current) / travelSeconds) * 0.78);
    node.style.transform = `translate3d(${x}px, -50%, 0) translateX(-50%)`;
  };

  useEffect(() => {
    let frame = 0;
    let first = 0;
    let previousTime = -Infinity;
    const draw = () => {
      time.current = (audio.current?.currentTime ?? 0) - offset / 1000;
      if (time.current < previousTime) first = 0;
      previousTime = time.current;
      while (
        first < chart.length &&
        chart[first].time < time.current - HIT_WINDOW_SECONDS
      )
        first++;
      const upcoming: RhythmNote[] = [];
      for (let index = first; index < chart.length; index++) {
        const note = chart[index];
        if (note.time > time.current + travelSeconds) break;
        if (judged.current.has(note.id)) continue;
        upcoming.push(note);
        const node = nodes.current.get(note.id);
        if (node) position(node, note);
      }
      if (
        upcoming.length !== visible.current.length ||
        upcoming.some((note, index) => note !== visible.current[index])
      ) {
        visible.current = upcoming;
        setNotes(upcoming);
      }
      if (phase === "playing") frame = requestAnimationFrame(draw);
    };
    const track = trackRef.current!;
    width.current = track.clientWidth;
    const observer = new ResizeObserver(([entry]) => {
      width.current = entry.contentRect.width;
      for (const note of visible.current) {
        const node = nodes.current.get(note.id);
        if (node) position(node, note);
      }
    });
    observer.observe(track);
    draw();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [chart, audio, judged, phase, offset, travelSeconds]);

  return (
    <div className="rhythm-note-track" ref={trackRef}>
      {notes.map((note) => (
        <div
          key={note.id}
          ref={(node) => {
            if (node) {
              nodes.current.set(note.id, node);
              position(node, note);
            } else nodes.current.delete(note.id);
          }}
          data-kind={note.kind}
          data-hand={note.hand}
          data-note-id={note.id}
          className={`rhythm-note rhythm-note--${note.kind}`}
        >
          <RhythmNoteArt kind={note.kind} />
          <b className="rhythm-note-hand">
            {note.hand === "left" ? "왼" : "오"}
          </b>
          <span>{note.kind === "center" ? "쿵" : "덕"}</span>
        </div>
      ))}
    </div>
  );
});

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
    endTime?: number;
    missLimit: number;
    paid: boolean;
  } | null>(null);
  const rankingSaveBusy = useRef(false);
  const [rankingSave, setRankingSave] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [songId, setSongId] = useState(RHYTHM_SONGS[0].id);
  const [mode, setMode] = useState<"practice" | "challenge">("practice");
  const [challenge, setChallenge] = useState<RhythmChallengeState | null>(null);
  const [challengeLoading, setChallengeLoading] = useState(false);
  const challengeLoadingRef = useRef(false);
  const [feedbackPoints, setFeedbackPoints] = useState(0);
  const [failedChallenge, setFailedChallenge] = useState(false);
  const [rankingSkipped, setRankingSkipped] = useState(false);
  const runMissLimit = useRef(Infinity);
  const runEndTime = useRef(0);
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
  const [canvasWidth, setCanvasWidth] = useState(0);
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
  // Rhythm is played by listening to the chart. Another game's background
  // music preference must not silently mute a new rhythm session.
  const [muted, setMuted] = useState(false);
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

  const selectChallenge = async () => {
    if (challengeLoadingRef.current || !playableRef.current) return;
    const token = generation.current;
    challengeLoadingRef.current = true;
    setChallengeLoading(true);
    setError("");
    try {
      const state = await getRhythmChallengeState(config);
      if (token !== generation.current) return;
      setChallenge(state);
      rankingRun.current = null;
      setSongId(state.songId);
      setDifficulty((current) => (current === "hard" ? "hard" : "normal"));
      setMode("challenge");
    } catch {
      if (token === generation.current)
        setError(
          "이번 주 도전을 확인하지 못했습니다. 도전 버튼을 다시 눌러 주세요.",
        );
    } finally {
      challengeLoadingRef.current = false;
      if (token === generation.current) setChallengeLoading(false);
    }
  };

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
  useEffect(() => {
    const canvas = canvasRef.current!;
    const observer = new ResizeObserver(() => {
      setCanvasWidth(canvas.clientWidth);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

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

  const start = async (paid = false) => {
    if (
      phaseRef.current === "starting" ||
      !playableRef.current ||
      portraitRef.current
    )
      return;
    if (
      mode === "challenge" &&
      (!challenge || (challenge.freeRemaining === 0 && !paid && !preview))
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
    setFeedbackPoints(0);
    setFailedChallenge(false);
    setRankingSkipped(false);
    runMissLimit.current =
      mode === "challenge" ? challenge!.missLimit : Infinity;
    runEndTime.current = 0;
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
      mode === "challenge" &&
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
        missLimit: challenge!.missLimit,
        paid,
      };
    }
    if (mode === "practice" || preview) rankingRun.current = null;
    try {
      await player.start(
        song,
        muted ? 0 : 0.65,
        preview || mode === "practice"
          ? undefined
          : async () => {
              const run = rankingRun.current!;
              const saved = await startRhythmRankingGame(config, {
                requestId: run.requestId,
                songId: run.songId,
                difficulty: run.difficulty,
                paid: run.paid,
              });
              if (token !== generation.current || rankingRun.current !== run)
                return false;
              run.sessionId = saved.sessionId;
              run.missLimit = saved.missLimit;
              runMissLimit.current = saved.missLimit;
              setChallenge((state) =>
                state
                  ? { ...state, freeRemaining: saved.freeRemaining }
                  : state,
              );
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
    } catch (reason) {
      if (token !== generation.current) return;
      player.dispose();
      setGamePhase("ready");
      const code =
        typeof reason === "object" && reason && "code" in reason
          ? String(reason.code)
          : "";
      setError(
        code.includes("resource-exhausted")
          ? "무료 도전 횟수 또는 위스 잔액을 확인해 주세요."
          : "연주를 시작하지 못했습니다. 연결 상태를 확인한 뒤 다시 시작해 주세요.",
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
      const result = await finishRhythmRankingGame(config, {
        sessionId: run.sessionId,
        events: run.events,
        endTime: run.endTime ?? runEndTime.current,
      });
      if (rankingRun.current === run) {
        setRankingSave("saved");
        setRankingSkipped(result.rankingSkipped === true);
      }
    } catch {
      if (rankingRun.current === run) setRankingSave("error");
    } finally {
      rankingSaveBusy.current = false;
    }
  }, [preview, config?.year, config?.semester]);
  const finish = useCallback(
    (endTime: number, failed = false) => {
      if (phaseRef.current === "result") return;
      runEndTime.current = endTime;
      if (rankingRun.current) rankingRun.current.endTime = endTime;
      setFailedChallenge(failed);
      audio.current?.stop();
      setGamePhase("result");
      setFeedback("");
      void saveRanking();
    },
    [setGamePhase, saveRanking],
  );
  useEffect(() => {
    if (phase !== "playing") return;
    let raf = 0;
    let lastDisplayTime = -Infinity;
    const tick = () => {
      if (phaseRef.current !== "playing" || !audio.current) return;
      if (audio.current.state !== "running" || !playableRef.current) {
        pause();
        return;
      }
      const time = audio.current.currentTime;
      const advanced = advanceMissedNotes(
        chart,
        judged.current,
        scoreRef.current,
        time - offset / 1000,
        runMissLimit.current,
      );
      const next = advanced.score;
      if (next !== scoreRef.current) {
        setFeedback(JUDGEMENT_TEXT.miss);
        setFeedbackGrade("miss");
        setFeedbackId((value) => value + 1);
        scoreRef.current = next;
        setScore(next);
      }
      if (time - lastDisplayTime >= 0.1 || time < lastDisplayTime) {
        lastDisplayTime = time;
        setElapsed(time);
      }
      if (advanced.terminated) {
        finish(advanced.endedAt, true);
        return;
      }
      if (time >= song.duration + Math.max(0, offset / 1000)) {
        finish(song.duration);
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
      const advanced = advanceMissedNotes(
        chart,
        judged.current,
        scoreRef.current,
        now - offset / 1000,
        runMissLimit.current,
      );
      if (advanced.score !== scoreRef.current) {
        setScore(advanced.score);
        setFeedback(JUDGEMENT_TEXT.miss);
        setFeedbackGrade("miss");
        setFeedbackId((value) => value + 1);
      }
      scoreRef.current = advanced.score;
      if (advanced.terminated) {
        setScore(advanced.score);
        finish(advanced.endedAt, true);
        return;
      }
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
      const previousScore = scoreRef.current.score;
      scoreRef.current = applyJudgement(scoreRef.current, judgement);
      const earnedPoints = scoreRef.current.score - previousScore;
      setFeedbackPoints(earnedPoints);
      setScore(scoreRef.current);
      setFeedback(JUDGEMENT_TEXT[judgement]);
      setFeedbackGrade(judgement);
      setFeedbackId((value) => value + 1);
      if (scoreRef.current.miss >= runMissLimit.current) {
        finish(now - offset / 1000, true);
        return;
      }
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
            points: earnedPoints,
          },
        ]);
      }
      judged.current.add(note.id);
    },
    [chart, offset, stage.rotated, finish],
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
  const noteWidth = Math.min(106, Math.max(72, canvasWidth * 0.08));
  const closestNoteGap = useMemo(
    () =>
      chart.reduce(
        (gap, note, index) =>
          index ? Math.min(gap, note.time - chart[index - 1].time) : gap,
        2.4,
      ),
    [chart],
  );
  // Larger notes retain a clear gap even in the fastest chart on a small screen.
  const laneTravelSeconds = Math.min(
    2.4,
    Math.max(
      0.55,
      ((canvasWidth - 64) * 0.78 * closestNoteGap) / (noteWidth + 8),
    ),
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
  const feverTier = getFeverTier(score.combo);

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
      data-fever={active ? feverTier : 0}
      data-mode={mode}
    >
      <div className="rhythm-canvas" ref={canvasRef}>
        <WeplayRanking
          gameId="gungdeok-rock"
          portal={preview ? "teacher" : "student"}
          initialCategory={`${songId}:${difficulty === "easy" ? "normal" : difficulty}`}
          disabled={
            !playable || phase === "starting" || rankingSave === "saving"
          }
          onOpen={pause}
        />
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
              {phase === "ready" && (
                <div
                  className="rhythm-mode-options"
                  role="group"
                  aria-label="연주 방식"
                >
                  <button
                    type="button"
                    className="rhythm-tool"
                    aria-pressed={mode === "practice"}
                    disabled={challengeLoading}
                    onClick={() => {
                      setMode("practice");
                      rankingRun.current = null;
                      setError("");
                    }}
                  >
                    연습
                  </button>
                  <button
                    type="button"
                    className="rhythm-tool"
                    aria-pressed={mode === "challenge"}
                    disabled={challengeLoading || !playable}
                    onClick={() => void selectChallenge()}
                  >
                    {challengeLoading ? "확인 중…" : "도전"}
                  </button>
                </div>
              )}
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
                      text: "소리가 늦게 들리면 시작 전에 판정 시차를 조절하세요. 연습은 횟수 제한 없이 즐기고, 도전 기록은 이번 주 랭킹에 반영됩니다.",
                    },
                    {
                      title: "판정과 점수",
                      text: "지화자 좋다! 1,000점 · 얼씨구 650점 · 좋다 300점. 잘못 치거나 놓치면 어이쿠, 콤보가 끊깁니다. 연타를 멈추고 다음 박자에 맞춰 치세요.",
                    },
                    {
                      title: "피버",
                      text: "10·20·50·100콤보부터 각각 5%·10%·25%·50%의 추가 점수를 얻습니다. 어이쿠가 나오면 피버가 끝납니다.",
                    },
                  ]}
                />
                <button
                  type="button"
                  className="rhythm-tool rhythm-icon-button"
                  onClick={() => {
                    const nextMuted = !muted;
                    audio.current?.setVolume(nextMuted ? 0 : 0.65);
                    setMuted(nextMuted);
                  }}
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
                    <legend>
                      {mode === "challenge" ? "이번 주 도전곡" : "오늘의 장단"}
                    </legend>
                    {RHYTHM_SONGS.filter(
                      (item) =>
                        mode === "practice" || item.id === challenge?.songId,
                    ).map((item) => (
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
                    {DIFFICULTIES.filter(
                      (item) => mode === "practice" || item.id !== "easy",
                    ).map((item) => (
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
                  {mode === "challenge" && challenge && (
                    <div className="rhythm-challenge-status">
                      <span>
                        {preview
                          ? "체험 · 횟수/위스 차감 없음"
                          : `오늘 무료 ${challenge.freeRemaining}/3회`}
                      </span>
                      <span>어이쿠 {challenge.missLimit}회면 종료</span>
                    </div>
                  )}
                  <div className="rhythm-start-row">
                    <button
                      type="button"
                      className="rhythm-primary rhythm-start-button"
                      disabled={!playable || challengeLoading}
                      onClick={() =>
                        void start(
                          mode === "challenge" &&
                            !preview &&
                            challenge?.freeRemaining === 0,
                        )
                      }
                    >
                      {mode === "practice"
                        ? "연주 시작"
                        : preview
                          ? "도전 체험 시작"
                          : challenge?.freeRemaining === 0
                            ? "50위스로 도전"
                            : "도전 시작"}{" "}
                      <RhythmIcon name="play" />
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
                    {failedChallenge ? "도전 종료" : "한 판, 얼쑤!"}
                  </h2>
                  <strong className="rhythm-result-score">
                    {score.score.toLocaleString()}
                    <small>점</small>
                  </strong>
                  {failedChallenge && <p>어이쿠 {runMissLimit.current}회</p>}
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
                      onClick={() => {
                        if (mode === "challenge") {
                          reset();
                          void selectChallenge();
                        } else void start();
                      }}
                    >
                      한 번 더
                    </button>
                  </div>
                  {!preview && rankingSave === "saving" && (
                    <p role="status">기록을 저장하고 있습니다.</p>
                  )}
                  {rankingSkipped && (
                    <p role="status">
                      주차가 바뀌어 이번 연주는 랭킹에 반영되지 않습니다.
                    </p>
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
                    <span>
                      {feverTier
                        ? `피버 +${FEVER_BONUSES[feverTier] * 100}%`
                        : "이어치기"}
                    </span>
                    <strong key={score.combo}>
                      {score.combo}
                      <small>콤보</small>
                    </strong>
                  </div>
                  {mode === "challenge" && (
                    <div className="rhythm-miss-counter">
                      <span>어이쿠</span>
                      <strong>
                        {score.miss}
                        <small>/{runMissLimit.current}</small>
                      </strong>
                    </div>
                  )}
                </div>
                <progress
                  className="rhythm-progress"
                  value={Math.max(0, elapsed - COUNT_IN_SECONDS)}
                  max={song.duration - COUNT_IN_SECONDS}
                  aria-label="연주 진행"
                />
                <div className="rhythm-play-field">
                  <div className="rhythm-lane-wrap">
                    {feverTier > 0 && (
                      <div
                        className="rhythm-fever-aura rhythm-fever-aura--belt"
                        aria-hidden="true"
                      />
                    )}
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
                      <RhythmLaneNotes
                        chart={chart}
                        audio={audio}
                        judged={judged}
                        phase={phase}
                        offset={offset}
                        travelSeconds={laneTravelSeconds}
                      />
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
                    {feverTier > 0 && (
                      <div
                        className="rhythm-fever-aura rhythm-fever-aura--drum"
                        aria-hidden="true"
                      />
                    )}
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
                          <small>+{feedbackPoints.toLocaleString()}</small>
                        )}
                    </div>
                    {[10, 20, 50, 100].includes(score.combo) && (
                      <div
                        key={score.combo}
                        className="rhythm-combo-cheer"
                        aria-hidden="true"
                      >
                        {score.combo}콤보 · 피버 +
                        {FEVER_BONUSES[feverTier] * 100}%
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
                            const hitButton = (
                              event.target as Element
                            ).closest<HTMLButtonElement>("[data-hit-kind]");
                            if (hitButton) {
                              event.preventDefault();
                              strike(
                                hitButton.dataset.hitKind as DrumKind,
                                hitButton.dataset.hand as DrumHand,
                              );
                              return;
                            }
                            const point = rhythmPointerPosition(
                              event.currentTarget.getBoundingClientRect(),
                              event.clientX,
                              event.clientY,
                              stage.rotated,
                            );
                            const kind = classifyDrumHit(point.x, point.y);
                            if (kind) {
                              event.preventDefault();
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
              <strong>+{note.points.toLocaleString()}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
