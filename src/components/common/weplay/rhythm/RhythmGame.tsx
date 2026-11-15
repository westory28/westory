import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InfoHelp } from "../../InfoHelp";
import RhythmDrum from "./RhythmDrum";
import { RhythmAudio } from "./rhythmAudio";
import { RHYTHM_SONGS } from "./rhythmSongs";
import {
  COUNT_IN_SECONDS,
  HIT_WINDOW_SECONDS,
  applyJudgement,
  classifyDrumHit,
  createChart,
  createScore,
  findHit,
  getJudgement,
  type DrumKind,
  type RhythmDifficulty,
} from "./rhythmCore";
import {
  isWeplayAudioMuted,
  onWeplayAudioMutedChange,
  setWeplayAudioMuted,
} from "../weplayAudioPreference";
import "./rhythm.css";

type Phase = "ready" | "starting" | "playing" | "paused" | "result";
const DIFFICULTIES: { id: RhythmDifficulty; name: string }[] = [
  { id: "easy", name: "가볍게" },
  { id: "normal", name: "신나게" },
  { id: "hard", name: "얼쑤!" },
];
const JUDGEMENT_TEXT = {
  perfect: "얼쑤!",
  good: "좋아요",
  ok: "이어가요",
  miss: "아쉬워요",
};

export default function RhythmGame({
  preview = false,
  playable = true,
  beforePlay,
}: {
  preview?: boolean;
  playable?: boolean;
  beforePlay?: () => Promise<boolean>;
}) {
  const [songId, setSongId] = useState(RHYTHM_SONGS[0].id);
  const [difficulty, setDifficulty] = useState<RhythmDifficulty>("normal");
  const [phase, setPhase] = useState<Phase>("ready");
  const phaseRef = useRef<Phase>("ready");
  const playableRef = useRef(playable);
  playableRef.current = playable;
  const [elapsed, setElapsed] = useState(0);
  const [score, setScore] = useState(createScore);
  const [feedback, setFeedback] = useState("");
  const [lastStrike, setLastStrike] = useState<{
    kind: DrumKind;
    at: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(isWeplayAudioMuted);
  const [offset, setOffset] = useState(0);
  const audio = useRef<RhythmAudio | null>(null);
  const judged = useRef(new Set<string>());
  const scoreRef = useRef(createScore());
  const generation = useRef(0);
  const gameRef = useRef<HTMLElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
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
    setGamePhase("paused");
    void audio.current?.pause().catch(() => {
      audio.current?.stop();
      setError("소리가 중단되었습니다. 곡을 다시 시작해 주세요.");
    });
  }, [setGamePhase]);
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
    if (phaseRef.current === "starting" || !playableRef.current) return;
    const token = ++generation.current;
    audio.current?.dispose();
    const player = new RhythmAudio();
    audio.current = player;
    judged.current = new Set();
    scoreRef.current = createScore();
    setScore(scoreRef.current);
    setElapsed(0);
    setFeedback("");
    setLastStrike(null);
    setError("");
    setGamePhase("starting");
    try {
      await player.start(song, muted ? 0 : 0.65, beforePlay);
      if (token !== generation.current) {
        player.dispose();
        return;
      }
      if (document.hidden || !playableRef.current) {
        await player.pause();
        setGamePhase("paused");
      } else setGamePhase("playing");
      gameRef.current?.focus({ preventScroll: true });
      gameRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
    } catch {
      if (token !== generation.current) return;
      player.dispose();
      setGamePhase("ready");
      setError(
        "연주를 시작하지 못했습니다. 연결과 소리 설정을 확인한 뒤 다시 시작해 주세요.",
      );
    }
  };
  const resume = async () => {
    if (phaseRef.current !== "paused" || !audio.current || !playableRef.current)
      return;
    const token = generation.current;
    setGamePhase("starting");
    try {
      if (beforePlay && !(await beforePlay()))
        throw new Error("게임을 다시 확인해 주세요.");
      if (token !== generation.current) return;
      if (!playableRef.current) {
        setGamePhase("paused");
        return;
      }
      await audio.current.resume();
      if (token !== generation.current) return;
      if (document.hidden || !playableRef.current) {
        await audio.current?.pause();
        setGamePhase("paused");
        return;
      }
      setGamePhase("playing");
      setError("");
      gameRef.current?.focus({ preventScroll: true });
    } catch {
      if (token === generation.current) {
        setGamePhase("paused");
        setError(
          "연주를 다시 시작하지 못했습니다. 연결과 소리 설정을 확인해 주세요.",
        );
      }
    }
  };
  const finish = useCallback(() => {
    audio.current?.stop();
    setGamePhase("result");
    setFeedback("");
  }, [setGamePhase]);
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
    (kind: DrumKind) => {
      if (
        phaseRef.current !== "playing" ||
        !playableRef.current ||
        !audio.current ||
        audio.current.state !== "running"
      )
        return;
      const now = audio.current.currentTime;
      audio.current.hit(kind);
      setLastStrike({ kind, at: now });
      const note = findHit(chart, judged.current, kind, now - offset / 1000);
      if (!note) return;
      const judgement = getJudgement(now - offset / 1000 - note.time);
      judged.current.add(note.id);
      scoreRef.current = applyJudgement(scoreRef.current, judgement);
      setScore(scoreRef.current);
      setFeedback(JUDGEMENT_TEXT[judgement]);
    },
    [chart, offset],
  );

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
        event.code === "KeyF" || event.code === "KeyJ"
          ? "center"
          : event.code === "KeyD" || event.code === "KeyK"
            ? "rim"
            : null;
      if (kind && phaseRef.current === "playing") {
        event.preventDefault();
        strike(kind);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [strike]);

  const reset = () => {
    generation.current++;
    audio.current?.dispose();
    audio.current = null;
    setGamePhase("ready");
    setElapsed(0);
    setError("");
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
  const accuracy = chart.length
    ? Math.round(
        ((score.perfect + score.good * 0.65 + score.ok * 0.3) / chart.length) *
          100,
      )
    : 0;

  return (
    <section
      ref={gameRef}
      className={`rhythm-game rhythm-game--${phase}`}
      tabIndex={-1}
      aria-label="덩기덕 쿵더Rock 경기장"
    >
      <div className="rhythm-stage-top">
        <span className="rhythm-eyebrow">
          {preview ? "교사 미리보기 · 기록 없음" : "우리의 장단, 나의 리듬"}
        </span>
        <div className="rhythm-stage-tools">
          <InfoHelp
            label="리듬 게임 조작 방법"
            sections={[
              {
                title: "쿵 · 덕",
                text: "채운 원은 북 가운데를, 빈 마름모는 북 가장자리를 누르세요. 노트가 아래 판정선에 닿을 때 맞춥니다.",
              },
              {
                title: "키보드",
                text: "가운데 F/J, 가장자리 D/K. Escape는 일시정지입니다. 북 버튼은 Enter와 Space로도 누를 수 있습니다.",
              },
              {
                title: "소리와 판정",
                text: "이어폰을 쓰면 박자를 듣기 쉽습니다. 블루투스 연결로 소리가 늦으면 시작 전 판정 시차를 조절하세요. 점수는 이번 연주에만 표시됩니다.",
              },
            ]}
          />
          <button
            type="button"
            className="rhythm-tool"
            onClick={() => setWeplayAudioMuted(!muted)}
            aria-pressed={muted}
          >
            {muted ? "소리 꺼짐" : "소리 켜짐"}
          </button>
          {phase === "playing" && (
            <button type="button" className="rhythm-tool" onClick={pause}>
              일시정지
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="rhythm-error" role="alert">
          {error}
        </p>
      )}
      {phase === "ready" ? (
        <div className="rhythm-lobby">
          <div className="rhythm-song-panel">
            <h2 className="rhythm-brand">
              덩기덕
              <br />
              <span>
                쿵더<span className="rhythm-rock">Rock</span>
              </span>
            </h2>
            <fieldset className="rhythm-songs">
              <legend>연주할 곡</legend>
              {RHYTHM_SONGS.map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  className="rhythm-song"
                  aria-pressed={song.id === item.id}
                  onClick={() => setSongId(item.id)}
                >
                  <span className="rhythm-song-number">0{index + 1}</span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.subtitle}</small>
                  </span>
                  <span className="rhythm-tempo">
                    {item.bpm}
                    <small>BPM</small>
                  </span>
                </button>
              ))}
            </fieldset>
            <fieldset className="rhythm-difficulty">
              <legend>난이도</legend>
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
              <span>
                {Math.round(song.duration - COUNT_IN_SECONDS)}초 ·{" "}
                {chart.length}박
              </span>
              <button
                type="button"
                className="rhythm-primary"
                disabled={!playable}
                onClick={() => void start()}
              >
                연주 시작 <span aria-hidden="true">→</span>
              </button>
            </div>
            <details className="rhythm-calibration">
              <summary>소리·판정 시차</summary>
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
                onChange={(event) => setOffset(Number(event.target.value))}
              />
              <p>
                터치가 늦게 맞으면 + 방향, 일찍 맞으면 − 방향으로 조절하세요.
              </p>
            </details>
          </div>
          <div className="rhythm-lobby-drum">
            <div className="rhythm-orbit" />
            <RhythmDrum />
            <div className="rhythm-drum-legend">
              <span>
                <b className="rhythm-symbol rhythm-symbol--center">●</b> 가운데
                · 쿵
              </span>
              <span>
                <b className="rhythm-symbol rhythm-symbol--rim">◇</b> 가장자리 ·
                덕
              </span>
            </div>
          </div>
        </div>
      ) : phase === "result" ? (
        <div className="rhythm-result">
          <span className="rhythm-eyebrow">{song.title}</span>
          <h2 ref={resultRef} tabIndex={-1}>
            한 판, 얼쑤!
          </h2>
          <strong className="rhythm-result-score">
            {score.score.toLocaleString()}
            <small>점</small>
          </strong>
          <dl>
            <div>
              <dt>정확도</dt>
              <dd>{accuracy}%</dd>
            </div>
            <div>
              <dt>최대 이어치기</dt>
              <dd>{score.maxCombo}</dd>
            </div>
            <div>
              <dt>얼쑤</dt>
              <dd>{score.perfect}</dd>
            </div>
            <div>
              <dt>좋아요</dt>
              <dd>{score.good}</dd>
            </div>
            <div>
              <dt>이어가요</dt>
              <dd>{score.ok}</dd>
            </div>
            <div>
              <dt>놓친 박자</dt>
              <dd>{score.miss}</dd>
            </div>
          </dl>
          <div className="rhythm-result-actions">
            <button type="button" className="rhythm-tool" onClick={reset}>
              곡 고르기
            </button>
            <button
              type="button"
              className="rhythm-primary"
              disabled={!playable}
              onClick={() => void start()}
            >
              한 번 더
            </button>
          </div>
        </div>
      ) : (
        <div className="rhythm-performance">
          <div className="rhythm-scorebar">
            <div>
              <span>{song.title}</span>
              <strong>
                {score.score.toLocaleString()}
                <small>점</small>
              </strong>
            </div>
            <div>
              <span>이어치기</span>
              <strong>
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
            <div
              className="rhythm-lanes"
              role="img"
              aria-label="가운데 쿵과 가장자리 덕 두 줄 악보"
            >
              <div className="rhythm-lane-labels">
                <span>● 쿵</span>
                <span>◇ 덕</span>
              </div>
              <div className="rhythm-lane-divider" />
              <div className="rhythm-hit-line">
                <i>●</i>
                <i>◇</i>
              </div>
              {upcoming.map((note) => (
                <div
                  key={note.id}
                  data-kind={note.kind}
                  className={`rhythm-note rhythm-note--${note.kind}`}
                  style={{
                    top: `${86 - ((note.time - chartTime) / 2.4) * 80}%`,
                  }}
                >
                  <span>{note.kind === "center" ? "쿵" : "덕"}</span>
                </div>
              ))}
            </div>
            <div className="rhythm-feedback" aria-hidden="true">
              {elapsed < COUNT_IN_SECONDS
                ? Math.max(1, Math.ceil(COUNT_IN_SECONDS - elapsed))
                : feedback}
            </div>
            <div
              className={`rhythm-play-drum ${lastStrike && elapsed - lastStrike.at < 0.12 ? `rhythm-struck--${lastStrike.kind}` : ""}`}
            >
              <RhythmDrum />
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
                  if (event.pointerType === "mouse" && event.button !== 0)
                    return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const kind = classifyDrumHit(
                    (event.clientX - rect.left) / rect.width,
                    (event.clientY - rect.top) / rect.height,
                  );
                  if (kind) {
                    event.preventDefault();
                    strike(kind);
                  }
                }}
              >
                <button
                  type="button"
                  className="rhythm-rim-button"
                  aria-label="북 가장자리 덕 (D 또는 K)"
                  disabled={phase !== "playing" || !playable}
                  onClick={(event) => {
                    if (event.detail === 0) strike("rim");
                  }}
                >
                  <span>
                    덕 <kbd>D · K</kbd>
                  </span>
                </button>
                <button
                  type="button"
                  className="rhythm-center-button"
                  aria-label="북 가운데 쿵 (F 또는 J)"
                  disabled={phase !== "playing" || !playable}
                  onClick={(event) => {
                    if (event.detail === 0) strike("center");
                  }}
                >
                  <span>
                    쿵 <kbd>F · J</kbd>
                  </span>
                </button>
              </div>
            </div>
          </div>
          {(phase === "paused" || phase === "starting") && (
            <div className="rhythm-pause">
              <h2>
                {!playable
                  ? "게임 연결 확인 중"
                  : phase === "starting"
                    ? "연주 준비 중"
                    : "잠시 쉬어 가요"}
              </h2>
              {phase === "paused" && (
                <div>
                  <button
                    type="button"
                    className="rhythm-primary"
                    disabled={!playable}
                    onClick={() => void resume()}
                  >
                    계속 연주
                  </button>
                  <button type="button" className="rhythm-tool" onClick={reset}>
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
    </section>
  );
}
